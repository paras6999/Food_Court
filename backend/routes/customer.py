from flask import Blueprint, request, jsonify
from flask_jwt_extended import get_jwt_identity, get_jwt, jwt_required
from bson import ObjectId
from datetime import datetime
from backend.db import restaurants_col, menu_col, orders_col, reviews_col, tables_col
from backend.utils.auth_helper import role_required

customer_bp = Blueprint("customer", __name__)


def _rest_to_dict(r):
    r["_id"] = str(r["_id"])
    r.pop("password", None)
    return r


def _item_to_dict(i):
    i["_id"] = str(i["_id"])
    i["restaurant_id"] = str(i["restaurant_id"])
    return i


def _order_to_dict(o):
    o["_id"] = str(o["_id"])
    o["user_id"] = str(o["user_id"])
    o["restaurant_id"] = str(o["restaurant_id"])
    o["created_at"] = o["created_at"].isoformat() if isinstance(o.get("created_at"), datetime) else str(o.get("created_at", ""))
    for item in o.get("items", []):
        item["item_id"] = str(item.get("item_id", ""))
    return o


# ── List / Search Restaurants ───────────────────────────────────────────────────
@customer_bp.route("/api/restaurants", methods=["GET"])
def list_restaurants():
    query_str = request.args.get("q", "").strip()
    cuisine = request.args.get("cuisine", "").strip()

    filt: dict = {"approved": {"$ne": False}}
    if query_str:
        filt["$or"] = [
            {"name": {"$regex": query_str, "$options": "i"}},
            {"cuisine": {"$regex": query_str, "$options": "i"}}
        ]
    if cuisine:
        filt["cuisine"] = {"$regex": cuisine, "$options": "i"}

    rests = list(restaurants_col.find(filt, {"password": 0}))
    for r in rests:
        r["_id"] = str(r["_id"])
    return jsonify(rests), 200


# ── Get Menu for Restaurant ─────────────────────────────────────────────────────
@customer_bp.route("/api/menu/<restaurant_id>", methods=["GET"])
def get_menu(restaurant_id):
    try:
        rid = ObjectId(restaurant_id)
    except Exception:
        return jsonify({"error": "Invalid restaurant id"}), 400

    items = list(menu_col.find({"restaurant_id": rid, "available": True}))
    return jsonify([_item_to_dict(i) for i in items]), 200


# ── Validate Table (QR Code Landing) ───────────────────────────────────────────
@customer_bp.route("/api/table/<restaurant_id>/<int:table_number>", methods=["GET"])
def validate_table(restaurant_id, table_number):
    """Validates that a table exists for the given restaurant. Called when
    a customer scans the QR code."""
    try:
        rid = ObjectId(restaurant_id)
    except Exception:
        return jsonify({"error": "Invalid restaurant id"}), 400

    table = tables_col.find_one({"restaurant_id": rid, "table_number": table_number})
    if not table:
        return jsonify({"error": "Table not found"}), 404

    rest = restaurants_col.find_one({"_id": rid, "approved": {"$ne": False}}, {"password": 0})
    if not rest:
        return jsonify({"error": "Restaurant not found or not active"}), 404

    rest["_id"] = str(rest["_id"])

    # Also fetch menu items
    items = list(menu_col.find({"restaurant_id": rid, "available": True}))

    return jsonify({
        "restaurant": rest,
        "table_number": table_number,
        "table_status": table.get("status", "available"),
        "menu": [_item_to_dict(i) for i in items]
    }), 200


# ── Place Order ─────────────────────────────────────────────────────────────────
@customer_bp.route("/api/order", methods=["POST"])
@role_required("customer")
def place_order():
    data = request.get_json()
    user_id = get_jwt_identity()
    restaurant_id = data.get("restaurant_id")
    items = data.get("items", [])
    address = data.get("address", "")
    table_number = data.get("table_number")  # Optional: for dine-in orders

    if not restaurant_id or not items:
        return jsonify({"error": "restaurant_id and items are required"}), 400

    try:
        rid = ObjectId(restaurant_id)
    except Exception:
        return jsonify({"error": "Invalid restaurant id"}), 400

    # If table_number is provided, validate the table exists
    if table_number is not None:
        table_number = int(table_number)
        table = tables_col.find_one({"restaurant_id": rid, "table_number": table_number})
        if not table:
            return jsonify({"error": f"Table {table_number} not found for this restaurant"}), 404

    # Validate and enrich items
    total = 0
    enriched = []
    for item in items:
        try:
            menu_item = menu_col.find_one({"_id": ObjectId(item["item_id"])})
        except Exception:
            return jsonify({"error": f"Invalid item_id {item.get('item_id')}"}), 400
        if not menu_item:
            return jsonify({"error": f"Menu item not found: {item.get('item_id')}"}), 404
        qty = int(item.get("quantity", 1))
        price = menu_item["price"]
        total += price * qty
        enriched.append({
            "item_id": menu_item["_id"],
            "name": menu_item["name"],
            "quantity": qty,
            "price": price
        })

    order_doc = {
        "user_id": ObjectId(user_id),
        "restaurant_id": rid,
        "items": enriched,
        "total_price": total,
        "address": address,
        "status": "pending",
        "created_at": datetime.utcnow()
    }

    # Add table_number and order_type for dine-in
    if table_number is not None:
        order_doc["table_number"] = table_number
        order_doc["order_type"] = "dine-in"
    else:
        order_doc["order_type"] = "delivery"

    order_id = orders_col.insert_one(order_doc).inserted_id

    return jsonify({"message": "Order placed successfully", "order_id": str(order_id)}), 201


# ── Service Request (Call Waiter) ──────────────────────────────────────────────
@customer_bp.route("/api/service-request", methods=["POST"])
@role_required("customer")
def service_request():
    data = request.get_json()
    restaurant_id = data.get("restaurant_id")
    table_number = data.get("table_number")
    request_type = data.get("request_type", "waiter")  # waiter, bill, water, etc.

    if not restaurant_id or table_number is None:
        return jsonify({"error": "restaurant_id and table_number required"}), 400

    try:
        rid = ObjectId(restaurant_id)
    except Exception:
        return jsonify({"error": "Invalid restaurant id"}), 400

    table_number = int(table_number)

    # Store the service request
    orders_col.insert_one({
        "user_id": ObjectId(get_jwt_identity()),
        "restaurant_id": rid,
        "table_number": table_number,
        "order_type": "service-request",
        "request_type": request_type,
        "items": [],
        "total_price": 0,
        "status": "pending",
        "address": "",
        "created_at": datetime.utcnow()
    })

    return jsonify({"message": f"Service request ({request_type}) sent to restaurant"}), 201


# ── Get Customer Orders ─────────────────────────────────────────────────────────
@customer_bp.route("/api/orders/me", methods=["GET"])
@role_required("customer")
def my_orders():
    user_id = get_jwt_identity()
    raw = list(orders_col.find({"user_id": ObjectId(user_id)}).sort("created_at", -1))

    # Attach restaurant names
    result = []
    for o in raw:
        d = _order_to_dict(o)
        rest = restaurants_col.find_one({"_id": ObjectId(d["restaurant_id"])}, {"name": 1})
        d["restaurant_name"] = rest["name"] if rest else "Unknown"
        result.append(d)
    return jsonify(result), 200


# ── Submit Review ───────────────────────────────────────────────────────────────
@customer_bp.route("/api/review", methods=["POST"])
@role_required("customer")
def submit_review():
    data = request.get_json()
    user_id = get_jwt_identity()
    claims = get_jwt()
    restaurant_id = data.get("restaurant_id")
    order_id = data.get("order_id")
    rating = float(data.get("rating", 0))
    comment = data.get("comment", "").strip()

    if not restaurant_id or not (1 <= rating <= 5):
        return jsonify({"error": "Valid restaurant_id and rating (1–5) required"}), 400

    try:
        rid = ObjectId(restaurant_id)
        oid = ObjectId(order_id) if order_id else None
    except Exception:
        return jsonify({"error": "Invalid id format"}), 400

    review_doc = {
        "user_id": ObjectId(user_id),
        "user_name": claims.get("name", "Customer"),
        "restaurant_id": rid,
        "rating": rating,
        "comment": comment,
        "created_at": datetime.utcnow()
    }
    
    if oid:
        review_doc["order_id"] = oid
        
    reviews_col.insert_one(review_doc)
    
    # Save the review back into the order to be easily queryable by customer/admin
    if oid:
        orders_col.update_one({"_id": oid}, {"$set": {"review": {"rating": rating, "comment": comment}}})

    # Recalculate restaurant rating
    pipeline = [
        {"$match": {"restaurant_id": rid}},
        {"$group": {"_id": None, "avg": {"$avg": "$rating"}, "count": {"$sum": 1}}}
    ]
    agg = list(reviews_col.aggregate(pipeline))
    if agg:
        restaurants_col.update_one(
            {"_id": rid},
            {"$set": {"rating": round(agg[0]["avg"], 1), "totalRatings": agg[0]["count"]}}
        )

    return jsonify({"message": "Review submitted"}), 201


# ── Get Reviews for Restaurant ──────────────────────────────────────────────────
@customer_bp.route("/api/reviews/<restaurant_id>", methods=["GET"])
def get_reviews(restaurant_id):
    try:
        rid = ObjectId(restaurant_id)
    except Exception:
        return jsonify({"error": "Invalid restaurant id"}), 400

    reviews = list(reviews_col.find({"restaurant_id": rid}).sort("created_at", -1).limit(20))
    for rv in reviews:
        rv["_id"] = str(rv["_id"])
        rv["user_id"] = str(rv["user_id"])
        rv["restaurant_id"] = str(rv["restaurant_id"])
        rv["created_at"] = rv["created_at"].isoformat() if isinstance(rv.get("created_at"), datetime) else ""
    return jsonify(reviews), 200


# ── Global Search ───────────────────────────────────────────────────────────────
@customer_bp.route("/api/search", methods=["GET"])
def global_search():
    query_str = request.args.get("q", "").strip()
    if not query_str:
        return jsonify({"restaurants": [], "menu_items": []}), 200

    # Search restaurants by name or cuisine
    r_filt = {
        "approved": {"$ne": False},
        "$or": [
            {"name": {"$regex": query_str, "$options": "i"}},
            {"cuisine": {"$regex": query_str, "$options": "i"}}
        ]
    }
    rests = list(restaurants_col.find(r_filt, {"password": 0}).limit(5))
    for r in rests:
        r["_id"] = str(r["_id"])

    # Search menu items
    m_filt = {
        "available": True,
        "name": {"$regex": query_str, "$options": "i"}
    }
    items = list(menu_col.find(m_filt).limit(10))
    
    # Enrich menu items with restaurant names
    enriched_items = []
    for item in items:
        rid = item["restaurant_id"]
        rest = restaurants_col.find_one({"_id": rid, "approved": {"$ne": False}}, {"name": 1})
        if rest:
            i_dict = _item_to_dict(item)
            i_dict["restaurant_name"] = rest["name"]
            enriched_items.append(i_dict)

    return jsonify({
        "restaurants": rests,
        "menu_items": enriched_items
    }), 200
