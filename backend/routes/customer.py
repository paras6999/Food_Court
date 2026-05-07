from flask import Blueprint, request, jsonify
from flask_jwt_extended import get_jwt_identity, get_jwt, jwt_required
from bson import ObjectId
from datetime import datetime, timedelta
import hmac, hashlib, razorpay, requests, os, re
from backend.db import restaurants_col, menu_col, orders_col, reviews_col, tables_col, group_carts_col, coupons_col, users_col
from backend.utils.auth_helper import role_required
from backend.config import Config

customer_bp = Blueprint("customer", __name__)
razorpay_client = razorpay.Client(auth=(Config.RAZORPAY_KEY_ID, Config.RAZORPAY_KEY_SECRET))


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


# ── Public: Get Tables for Floor Plan ───────────────────────────────────────────
@customer_bp.route("/api/restaurant/<restaurant_id>/tables", methods=["GET"])
def get_restaurant_tables(restaurant_id):
    try:
        rid = ObjectId(restaurant_id)
    except Exception:
        return jsonify({"error": "Invalid restaurant id"}), 400
        
    tables = list(tables_col.find({"restaurant_id": rid}))
    for t in tables:
        t["_id"] = str(t["_id"])
        t["restaurant_id"] = str(t["restaurant_id"])
    return jsonify(tables), 200

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


# ── User Profile & Loyalty ──────────────────────────────────────────────────────
@customer_bp.route("/api/user/profile", methods=["GET"])
@role_required("customer")
def get_user_profile():
    user_id = get_jwt_identity()
    from backend.db import users_col
    user = users_col.find_one({"_id": ObjectId(user_id)})
    if not user:
        return jsonify({"error": "User not found"}), 404
        
    return jsonify({
        "name": user.get("name", ""),
        "email": user.get("email", ""),
        "fc_points": user.get("fc_points", 0)
    }), 200


# ── Place Order ─────────────────────────────────────────────────────────────────
@customer_bp.route("/api/order", methods=["POST"])
@jwt_required(optional=True)
def place_order():
    data = request.get_json()
    user_id = get_jwt_identity()
    claims = get_jwt()
    if claims and claims.get("role") != "customer":
        # Ignore non-customer tokens (e.g. admin or restaurant)
        user_id = None
        
    restaurant_id = data.get("restaurant_id")
    items = data.get("items", [])
    address = data.get("address", "")
    table_number = data.get("table_number")  # Optional: for dine-in orders
    mobile_number = data.get("mobile_number", "").strip()  # For WhatsApp bill

    # If it's a delivery order and no user_id, fail
    if table_number is None and not user_id:
        return jsonify({"error": "Login required for delivery orders"}), 401

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
    # Validate and enrich items
    total = 0
    enriched = []
    for item in items:
        item_id_str = str(item.get("item_id", ""))
        is_custom = False
        menu_item = None
        try:
            oid = ObjectId(item_id_str)
            menu_item = menu_col.find_one({"_id": oid})
        except Exception:
            is_custom = True
            
        if is_custom:
            qty = int(item.get("quantity", 1))
            price = float(item.get("price", 0))
            name = item.get("name", "Custom Item")
            total += price * qty
            enriched.append({
                "item_id": item_id_str,
                "name": name,
                "quantity": qty,
                "price": price
            })
            continue

        if not menu_item:
            return jsonify({"error": f"Menu item not found: {item_id_str}"}), 404
        qty = int(item.get("quantity", 1))
        price = menu_item["price"]
        total += price * qty
        enriched.append({
            "item_id": menu_item["_id"],
            "name": menu_item["name"],
            "quantity": qty,
            "price": price
        })

    # Apply restaurant discount if the user is logged in
    rest = restaurants_col.find_one({"_id": rid})
    if user_id and rest and rest.get("discount_pct"):
        r_discount = float(rest.get("discount_pct", 0))
        total = total * (1 - (r_discount / 100))

    # Apply per-restaurant coupon discount
    coupon_code = data.get("coupon_code", "").upper().strip()
    coupon_discount = 0
    if coupon_code:
        coupon_doc = coupons_col.find_one({
            "restaurant_id": rid,
            "code": coupon_code,
            "enabled": True
        })
        
        if coupon_doc:
            valid = True
            min_order = float(coupon_doc.get("min_order", 0))
            if min_order > total: 
                valid = False
            if coupon_doc.get("first_order_only") and user_id:
                if orders_col.count_documents({"user_id": ObjectId(user_id)}) > 0: 
                    valid = False
            
            if valid:
                c_val = float(coupon_doc.get("value", 0))
                c_max = float(coupon_doc.get("max_discount", 999999))
                if coupon_doc["type"] == "percent":
                    coupon_discount = (c_val / 100.0) * total
                    if coupon_discount > c_max:
                        coupon_discount = c_max
                elif coupon_doc["type"] == "flat":
                    coupon_discount = c_val
                if coupon_discount > total: 
                    coupon_discount = total
                total -= coupon_discount
    
    # Loyalty Points Usage
    points_used = 0
    points_discount = 0
    earned_points = 0
    if user_id:
        user = users_col.find_one({"_id": ObjectId(user_id)})
        if user and data.get("use_points") and user.get("fc_points", 0) > 0:
            user_points = user["fc_points"]
            max_discount = user_points / 10.0 # 10 points = 1 INR
            if max_discount > total:
                points_discount = total
                points_used = int(total * 10)
            else:
                points_discount = max_discount
                points_used = user_points
            total -= points_discount
            users_col.update_one({"_id": ObjectId(user_id)}, {"$inc": {"fc_points": -points_used}})
            
        # Earn points on final total
        earned_points = int(total // 10)
        if earned_points > 0:
            users_col.update_one({"_id": ObjectId(user_id)}, {"$inc": {"fc_points": earned_points}})

    order_doc = {
        "user_id": ObjectId(user_id) if user_id else "guest",
        "restaurant_id": rid,
        "items": enriched,
        "total_price": round(total, 2),
        "points_used": points_used,
        "points_discount": points_discount,
        "earned_points": earned_points,
        "address": address,
        "status": "pending",
        "created_at": datetime.utcnow() + timedelta(hours=5, minutes=30)
    }

    # Add mobile number if provided for WhatsApp bill
    if mobile_number:
        order_doc["customer_mobile"] = mobile_number

    # Add table_number and order_type for dine-in
    if table_number is not None:
        order_doc["table_number"] = table_number
        order_doc["order_type"] = "dine-in"
    else:
        order_doc["order_type"] = "delivery"

    order_id = orders_col.insert_one(order_doc).inserted_id

    return jsonify({"message": "Order placed successfully", "order_id": str(order_id)}), 201

# ── Group Cart Endpoints ──────────────────────────────────
@customer_bp.route("/api/cart/group/join", methods=["POST"])
@role_required("customer")
def join_group_cart():
    data = request.get_json()
    restaurant_id = data.get("restaurant_id")
    table_number = data.get("table_number")

    if not restaurant_id or table_number is None:
        return jsonify({"error": "restaurant_id and table_number required"}), 400

    try:
        rid = ObjectId(restaurant_id)
    except Exception:
        return jsonify({"error": "Invalid restaurant id"}), 400

    table_number = int(table_number)

    # Check if table exists
    table = tables_col.find_one({"restaurant_id": rid, "table_number": table_number})
    if not table:
        return jsonify({"error": f"Table {table_number} not found"}), 404

    user_id = get_jwt_identity()
    user_name = get_jwt().get("name", "Customer")

    # Find or create group cart
    group_cart = group_carts_col.find_one({"restaurant_id": rid, "table_number": table_number})
    is_creator = False
    if not group_cart:
        group_cart = {
            "restaurant_id": rid,
            "table_number": table_number,
            "created_by": user_id,
            "participants": [],
            "items": [],
            "created_at": datetime.utcnow() + timedelta(hours=5, minutes=30)
        }
        is_creator = True
    else:
        is_creator = group_cart.get("created_by") == user_id

    # Add user if not already participating
    if not any(p["user_id"] == user_id for p in group_cart.get("participants", [])):
        group_cart["participants"].append({
            "user_id": user_id,
            "user_name": user_name,
            "joined_at": datetime.utcnow() + timedelta(hours=5, minutes=30)
        })
        group_carts_col.replace_one(
            {"restaurant_id": rid, "table_number": table_number},
            group_cart,
            upsert=True
        )

    cart_dict = _group_cart_to_dict(group_cart)
    cart_dict["is_creator"] = is_creator
    return jsonify({"message": "Joined group cart", "cart": cart_dict}), 200

@customer_bp.route("/api/cart/group/add", methods=["POST"])
@role_required("customer")
def add_to_group_cart():
    data = request.get_json()
    restaurant_id = data.get("restaurant_id")
    table_number = data.get("table_number")
    item_id = data.get("item_id")
    quantity = data.get("quantity", 1)
    options = data.get("options", "")

    if not restaurant_id or table_number is None or not item_id:
        return jsonify({"error": "restaurant_id, table_number, and item_id required"}), 400

    try:
        rid = ObjectId(restaurant_id)
        iid = ObjectId(item_id)
    except Exception:
        return jsonify({"error": "Invalid id format"}), 400

    table_number = int(table_number)
    quantity = int(quantity)

    # Check if user is in group cart
    user_id = get_jwt_identity()
    user_name = get_jwt().get("name", "Customer")

    group_cart = group_carts_col.find_one({"restaurant_id": rid, "table_number": table_number})
    if not group_cart or not any(p["user_id"] == user_id for p in group_cart.get("participants", [])):
        return jsonify({"error": "Not part of this group cart"}), 403

    # Get menu item
    menu_item = menu_col.find_one({"_id": iid})
    if not menu_item:
        return jsonify({"error": "Menu item not found"}), 404

    # Add item with user attribution
    item_key = f"{item_id}_{options}"
    existing_item = next((i for i in group_cart.get("items", []) if i["item_key"] == item_key), None)

    if existing_item:
        existing_item["quantity"] += quantity
    else:
        group_cart["items"].append({
            "item_key": item_key,
            "item_id": iid,
            "name": menu_item["name"],
            "price": menu_item["price"],
            "quantity": quantity,
            "options": options,
            "added_by": user_name,
            "added_by_id": user_id
        })

    group_carts_col.replace_one(
        {"restaurant_id": rid, "table_number": table_number},
        group_cart
    )

    return jsonify({"message": "Item added to group cart", "cart": _group_cart_to_dict(group_cart)}), 200

@customer_bp.route("/api/cart/group/remove", methods=["POST"])
@role_required("customer")
def remove_from_group_cart():
    data = request.get_json()
    restaurant_id = data.get("restaurant_id")
    table_number = data.get("table_number")
    item_key = data.get("item_key")

    if not restaurant_id or table_number is None or not item_key:
        return jsonify({"error": "restaurant_id, table_number, and item_key required"}), 400

    try:
        rid = ObjectId(restaurant_id)
    except Exception:
        return jsonify({"error": "Invalid restaurant id"}), 400

    table_number = int(table_number)
    user_id = get_jwt_identity()

    group_cart = group_carts_col.find_one({"restaurant_id": rid, "table_number": table_number})
    if not group_cart or not any(p["user_id"] == user_id for p in group_cart.get("participants", [])):
        return jsonify({"error": "Not part of this group cart"}), 403

    # Remove the item
    group_cart["items"] = [i for i in group_cart.get("items", []) if i["item_key"] != item_key]

    group_carts_col.replace_one(
        {"restaurant_id": rid, "table_number": table_number},
        group_cart
    )

    return jsonify({"message": "Item removed from group cart", "cart": _group_cart_to_dict(group_cart)}), 200

@customer_bp.route("/api/cart/group/update-quantity", methods=["POST"])
@role_required("customer")
def update_group_cart_quantity():
    data = request.get_json()
    restaurant_id = data.get("restaurant_id")
    table_number = data.get("table_number")
    item_key = data.get("item_key")
    quantity = data.get("quantity", 1)

    if not restaurant_id or table_number is None or not item_key:
        return jsonify({"error": "restaurant_id, table_number, and item_key required"}), 400

    try:
        rid = ObjectId(restaurant_id)
    except Exception:
        return jsonify({"error": "Invalid restaurant id"}), 400

    table_number = int(table_number)
    quantity = int(quantity)
    user_id = get_jwt_identity()

    group_cart = group_carts_col.find_one({"restaurant_id": rid, "table_number": table_number})
    if not group_cart or not any(p["user_id"] == user_id for p in group_cart.get("participants", [])):
        return jsonify({"error": "Not part of this group cart"}), 403

    # Find and update the item
    for item in group_cart.get("items", []):
        if item["item_key"] == item_key:
            if quantity <= 0:
                group_cart["items"].remove(item)
            else:
                item["quantity"] = quantity
            break

    group_carts_col.replace_one(
        {"restaurant_id": rid, "table_number": table_number},
        group_cart
    )

    return jsonify({"message": "Quantity updated", "cart": _group_cart_to_dict(group_cart)}), 200

@customer_bp.route("/api/cart/group/sync", methods=["GET"])
@role_required("customer")
def sync_group_cart():
    """Sync group cart for real-time updates"""
    restaurant_id = request.args.get("restaurant_id")
    table_number = request.args.get("table_number")
    
    if not restaurant_id or table_number is None:
        return jsonify({"error": "restaurant_id and table_number required"}), 400
    
    try:
        rid = ObjectId(restaurant_id)
    except Exception:
        return jsonify({"error": "Invalid restaurant id"}), 400
    
    table_number = int(table_number)
    user_id = get_jwt_identity()
    
    group_cart = group_carts_col.find_one({"restaurant_id": rid, "table_number": table_number})
    if not group_cart or not any(p["user_id"] == user_id for p in group_cart.get("participants", [])):
        return jsonify({"error": "Not part of this group cart"}), 403
    
    return jsonify({"cart": _group_cart_to_dict(group_cart)}), 200

def _group_cart_to_dict(gc):
    if "_id" in gc:
        gc["_id"] = str(gc["_id"])
    gc["restaurant_id"] = str(gc["restaurant_id"])
    if "created_by" in gc:
        gc["created_by"] = str(gc["created_by"])
    for item in gc.get("items", []):
        item["item_id"] = str(item["item_id"])
        item["added_by_id"] = str(item["added_by_id"])
    for p in gc.get("participants", []):
        p["user_id"] = str(p["user_id"])
    return gc

@customer_bp.route("/api/cart/group/place-order", methods=["POST"])
@role_required("customer")
def place_group_order():
    try:
        data = request.get_json() or {}
        restaurant_id = data.get("restaurant_id")
        table_number = data.get("table_number")

        if not restaurant_id or table_number is None:
            return jsonify({"error": "restaurant_id and table_number required"}), 400

        try:
            rid = ObjectId(restaurant_id)
        except Exception:
            return jsonify({"error": "Invalid restaurant id"}), 400

        table_number = int(table_number)
        user_id = get_jwt_identity()

        group_cart = group_carts_col.find_one({"restaurant_id": rid, "table_number": table_number})
        if not group_cart:
            return jsonify({"error": "No group cart found"}), 404

        if group_cart.get("created_by") != user_id:
            return jsonify({"error": "Only the person who started the group order can place it"}), 403

        cart_items = group_cart.get("items", [])
        if not cart_items:
            return jsonify({"error": "Group cart is empty"}), 400

        total = 0
        enriched = []
        for item in cart_items:
            qty = int(item.get("quantity", 1))
            price = float(item.get("price", 0))
            total += price * qty
            enriched.append({
                "item_id": item.get("item_id"),
                "name": item.get("name", "Item"),
                "quantity": qty,
                "price": price
            })

        original_total = total
        restaurant_discount = 0
        rest = restaurants_col.find_one({"_id": rid})
        if user_id and rest and rest.get("discount_pct"):
            r_discount = float(rest.get("discount_pct", 0))
            restaurant_discount = total * (r_discount / 100)
            total -= restaurant_discount

        mobile_number = data.get("mobile_number", "").strip()
        coupon_code = data.get("coupon_code", "").upper().strip()

        coupon_discount = 0
        if coupon_code:
            coupon_doc = coupons_col.find_one({"restaurant_id": rid, "code": coupon_code, "enabled": True})
            if not coupon_doc and coupon_code in COUPONS:
                coupon_doc = COUPONS[coupon_code]
            if coupon_doc:
                c_val = float(coupon_doc.get("value", 0))
                c_max = float(coupon_doc.get("max_discount", 999999))
                if coupon_doc["type"] == "percent":
                    coupon_discount = (c_val / 100.0) * total
                    if coupon_discount > c_max:
                        coupon_discount = c_max
                elif coupon_doc["type"] == "flat":
                    coupon_discount = c_val
                if coupon_discount > total:
                    coupon_discount = total
                total -= coupon_discount

        order_doc = {
            "user_id": ObjectId(user_id),
            "restaurant_id": rid,
            "items": enriched,
            "subtotal": round(original_total, 2),
            "restaurant_discount": round(restaurant_discount, 2),
            "coupon_code": coupon_code if coupon_discount > 0 else "",
            "coupon_discount": round(coupon_discount, 2),
            "total_price": round(total, 2),
            "address": f"Dine-In — Table {table_number}",
            "status": "pending",
            "created_at": datetime.utcnow() + timedelta(hours=5, minutes=30),
            "table_number": table_number,
            "order_type": "dine-in",
            "is_group_order": True,
            "group_participants": [p.get("user_name", "Guest") for p in group_cart.get("participants", [])]
        }

        if mobile_number:
            order_doc["customer_mobile"] = mobile_number

        order_id = orders_col.insert_one(order_doc).inserted_id

        group_carts_col.delete_one({"restaurant_id": rid, "table_number": table_number})

        return jsonify({"message": "Group order placed successfully!", "order_id": str(order_id)}), 201
    except Exception as e:
        return jsonify({"error": f"Internal error placing group order: {str(e)}"}), 500

# ── Service Request (Call Waiter) ──────────────────────────────────────────────
@customer_bp.route("/api/service-request", methods=["POST"])
@jwt_required(optional=True)
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

    user_id = get_jwt_identity()
    user_oid = ObjectId(user_id) if user_id else "guest"

    # Store the service request
    orders_col.insert_one({
        "user_id": user_oid,
        "restaurant_id": rid,
        "table_number": table_number,
        "order_type": "service-request",
        "request_type": request_type,
        "items": [],
        "total_price": 0,
        "status": "pending",
        "address": "",
        "created_at": datetime.utcnow() + timedelta(hours=5, minutes=30)
    })

    return jsonify({"message": f"Service request ({request_type}) sent to restaurant"}), 201


# ── Get Customer Orders ─────────────────────────────────────────────────────────
@customer_bp.route("/api/orders/me", methods=["GET"])
@role_required("customer")
def my_orders():
    user_id = get_jwt_identity()
    raw = list(orders_col.find({
        "user_id": ObjectId(user_id),
        "order_type": {"$ne": "service-request"}
    }).sort("created_at", -1))

    # Attach restaurant names
    result = []
    for o in raw:
        d = _order_to_dict(o)
        rest = restaurants_col.find_one({"_id": ObjectId(d["restaurant_id"])}, {"name": 1})
        d["restaurant_name"] = rest["name"] if rest else "Unknown"
        result.append(d)
    return jsonify(result), 200

# ── Get Guest Orders ────────────────────────────────────────────────────────────
@customer_bp.route("/api/orders/guest", methods=["POST"])
def guest_orders():
    data = request.get_json() or {}
    order_ids = data.get("order_ids", [])
    
    if not isinstance(order_ids, list):
        return jsonify({"error": "order_ids must be a list"}), 400
        
    valid_oids = []
    for oid in order_ids:
        try:
            valid_oids.append(ObjectId(oid))
        except Exception:
            pass
            
    if not valid_oids:
        return jsonify([]), 200
        
    raw = list(orders_col.find({
        "_id": {"$in": valid_oids},
        "order_type": {"$ne": "service-request"}
    }).sort("created_at", -1))
    
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
        "created_at": datetime.utcnow() + timedelta(hours=5, minutes=30)
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
        rid = None

    # Support both ObjectId and string ID to handle legacy/mismatched data
    query_variants = []
    if rid: 
        query_variants.append({"restaurant_id": rid})
        query_variants.append({"restaurant_id": str(rid)})
    query_variants.append({"restaurant_id": restaurant_id.strip()})
    
    # Final fallback: case-insensitive string match
    query_variants.append({"restaurant_id": {"$regex": f"^{re.escape(restaurant_id.strip())}$", "$options": "i"}})

    reviews = list(reviews_col.find({"$or": query_variants}).sort("created_at", -1).limit(50))
    
    # Debug print for server logs
    print(f"DEBUG: Review query for {restaurant_id} returned {len(reviews)} items.")
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


# ── Cancel Order ────────────────────────────────────────────────────────────────
@customer_bp.route("/api/order/<order_id>/cancel", methods=["POST"])
@role_required("customer")
def cancel_order(order_id):
    user_id = get_jwt_identity()
    try:
        oid = ObjectId(order_id)
    except Exception:
        return jsonify({"error": "Invalid order id"}), 400

    order = orders_col.find_one({"_id": oid, "user_id": ObjectId(user_id)})
    if not order:
        return jsonify({"error": "Order not found or unauthorized"}), 404

    if order.get("status") != "pending":
        return jsonify({"error": "Order cannot be cancelled — restaurant has already started processing it"}), 400

    orders_col.update_one(
        {"_id": oid},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.utcnow() + timedelta(hours=5, minutes=30)}}
    )
    return jsonify({"message": "Order cancelled successfully"}), 200

# ── Get Order by ID (For Digital Bill) ──────────────────────────────────────────
@customer_bp.route("/api/order/<order_id>", methods=["GET"])
def get_order_by_id(order_id):
    try:
        oid = ObjectId(order_id)
    except Exception:
        return jsonify({"error": "Invalid order id"}), 400

    order = orders_col.find_one({"_id": oid})
    if not order:
        return jsonify({"error": "Order not found"}), 404
        
    order_dict = _order_to_dict(order)
    
    # Enrich with restaurant details for the bill
    rest = restaurants_col.find_one({"_id": ObjectId(order_dict["restaurant_id"])}, {"name": 1, "address": 1})
    if rest:
        order_dict["restaurant_name"] = rest.get("name", "Restaurant")
        order_dict["restaurant_address"] = rest.get("address", "")
        
    # Get user name if possible
    if order_dict.get("user_id") and order_dict.get("user_id") != "guest":
        from backend.db import users_col
        try:
            user = users_col.find_one({"_id": ObjectId(order_dict["user_id"])})
            if user:
                order_dict["customer_name"] = user.get("name", "Customer")
        except:
            pass
            
    if "customer_name" not in order_dict:
        order_dict["customer_name"] = "Guest"

    return jsonify(order_dict), 200


# ── Coupon Validation ───────────────────────────────────────────────────────────
COUPONS = {
    "WELCOME50": {"type": "percent", "value": 50, "max_discount": 100, "min_order": 0, "first_order_only": True},
    "FIRSTORDER": {"type": "flat", "value": 100, "max_discount": 100, "min_order": 200, "first_order_only": True},
    "FESTIVE20": {"type": "percent", "value": 20, "max_discount": 150, "min_order": 0, "first_order_only": False},
    "NIGHTOWL": {"type": "percent", "value": 15, "max_discount": 100, "min_order": 0, "first_order_only": False},
    "FREEDELIVERY": {"type": "flat", "value": 50, "max_discount": 50, "min_order": 150, "first_order_only": False},
    "WEEKENDVIBES": {"type": "flat", "value": 75, "max_discount": 75, "min_order": 300, "first_order_only": False}
}

@customer_bp.route("/api/coupon/validate", methods=["POST"])
@jwt_required(optional=True)
def validate_coupon():
    data = request.get_json() or {}
    code = str(data.get("code", "")).upper().strip()
    subtotal = float(data.get("subtotal", 0))
    restaurant_id = data.get("restaurant_id")
    user_id = get_jwt_identity()

    if not code:
        return jsonify({"valid": False, "message": "Coupon code is empty"}), 400

    if not restaurant_id:
        return jsonify({"valid": False, "message": "Restaurant ID is required"}), 400

    try:
        rid = ObjectId(restaurant_id)
    except Exception:
        return jsonify({"valid": False, "message": "Invalid restaurant ID"}), 400

    # Check per-restaurant coupon first
    coupon_doc = coupons_col.find_one({
        "restaurant_id": rid,
        "code": code,
        "enabled": True
    })

    if not coupon_doc:
        # Check global coupons
        if code in COUPONS:
            coupon_doc = COUPONS[code]
        else:
            return jsonify({"valid": False, "message": "Invalid coupon code for this restaurant"}), 400

    if coupon_doc.get("min_order", 0) > subtotal:
        return jsonify({"valid": False, "message": f"Minimum order of ₹{coupon_doc.get('min_order', 0)} required"}), 400

    if coupon_doc.get("first_order_only"):
        if not user_id:
            return jsonify({"valid": False, "message": "You must be logged in to use this coupon"}), 401
        
        # Check if user has previous orders
        previous_orders = orders_col.count_documents({"user_id": ObjectId(user_id)})
        if previous_orders > 0:
            return jsonify({"valid": False, "message": "This coupon is only valid for your first order"}), 400

    # Calculate discount
    discount = 0
    if coupon_doc["type"] == "percent":
        discount = (coupon_doc["value"] / 100.0) * subtotal
        if discount > coupon_doc.get("max_discount", 999999):
            discount = coupon_doc.get("max_discount", 999999)
    elif coupon_doc["type"] == "flat":
        discount = coupon_doc["value"]

    # Don't let discount exceed subtotal
    if discount > subtotal:
        discount = subtotal

    return jsonify({
        "valid": True,
        "code": code,
        "discount_amount": round(discount, 2),
        "message": f"Coupon '{code}' applied successfully!"
    }), 200


# ── Razorpay: Create Payment Order ──────────────────────────────────────────────
@customer_bp.route("/api/payment/create-order", methods=["POST"])
@role_required("customer")
def create_payment_order():
    data = request.get_json()
    amount_rupees = data.get("amount", 0)

    if amount_rupees <= 0:
        return jsonify({"error": "Invalid amount"}), 400

    # Razorpay expects amount in paise (1 INR = 100 paise)
    amount_paise = int(float(amount_rupees) * 100)

    try:
        rzp_order = razorpay_client.order.create({
            "amount": amount_paise,
            "currency": "INR",
            "receipt": f"fc_{ObjectId()}",
            "payment_capture": 1
        })
    except Exception as e:
        return jsonify({"error": f"Razorpay error: {str(e)}"}), 500

    return jsonify({
        "razorpay_order_id": rzp_order["id"],
        "amount": amount_paise,
        "currency": "INR",
        "key_id": Config.RAZORPAY_KEY_ID
    }), 200


# ── Razorpay: Verify Payment & Place Food Order ──────────────────────────────────
@customer_bp.route("/api/payment/verify", methods=["POST"])
@role_required("customer")
def verify_payment_and_place_order():
    data = request.get_json()
    razorpay_order_id   = data.get("razorpay_order_id", "")
    razorpay_payment_id = data.get("razorpay_payment_id", "")
    razorpay_signature  = data.get("razorpay_signature", "")
    mobile_number = data.get("mobile_number", "").strip()  # For WhatsApp bill

    # Verify HMAC-SHA256 signature
    msg = f"{razorpay_order_id}|{razorpay_payment_id}".encode()
    expected = hmac.new(Config.RAZORPAY_KEY_SECRET.encode(), msg, hashlib.sha256).hexdigest()
    if expected != razorpay_signature:
        return jsonify({"error": "Payment verification failed — invalid signature"}), 400

    # Now place the actual food order
    user_id       = get_jwt_identity()
    restaurant_id = data.get("restaurant_id")
    items         = data.get("items", [])
    address       = data.get("address", "")
    table_number  = data.get("table_number")

    if not restaurant_id or not items:
        return jsonify({"error": "restaurant_id and items are required"}), 400

    try:
        rid = ObjectId(restaurant_id)
    except Exception:
        return jsonify({"error": "Invalid restaurant id"}), 400

    # Validate table if dine-in
    if table_number is not None:
        table_number = int(table_number)
        table = tables_col.find_one({"restaurant_id": rid, "table_number": table_number})
        if not table:
            return jsonify({"error": f"Table {table_number} not found"}), 404

    # Enrich items from DB
    total = 0
    enriched = []
    for item in items:
        item_id_str = str(item.get("item_id", ""))
        is_custom = False
        menu_item = None
        try:
            oid = ObjectId(item_id_str)
            menu_item = menu_col.find_one({"_id": oid})
        except Exception:
            is_custom = True
            
        if is_custom:
            qty = int(item.get("quantity", 1))
            price = float(item.get("price", 0))
            name = item.get("name", "Custom Item")
            total += price * qty
            enriched.append({
                "item_id": item_id_str,
                "name": name,
                "quantity": qty,
                "price": price
            })
            continue

        if not menu_item:
            return jsonify({"error": f"Menu item not found: {item_id_str}"}), 404
        qty = int(item.get("quantity", 1))
        price = menu_item["price"]
        total += price * qty
        enriched.append({
            "item_id": menu_item["_id"],
            "name": menu_item["name"],
            "quantity": qty,
            "price": price
        })

    original_total = total
    restaurant_discount = 0
    # Apply restaurant discount if the user is logged in
    rest = restaurants_col.find_one({"_id": rid})
    if user_id and rest and rest.get("discount_pct"):
        r_discount = float(rest.get("discount_pct", 0))
        restaurant_discount = total * (r_discount / 100)
        total -= restaurant_discount

    # Apply per-restaurant coupon discount
    coupon_code = data.get("coupon_code", "").upper().strip()
    coupon_discount = 0
    if coupon_code:
        coupon_doc = coupons_col.find_one({
            "restaurant_id": rid,
            "code": coupon_code,
            "enabled": True
        })
        
        if not coupon_doc and coupon_code in COUPONS:
            coupon_doc = COUPONS[coupon_code]
            
        if coupon_doc:
            valid = True
            min_order = float(coupon_doc.get("min_order", 0))
            if min_order > total: 
                valid = False
            if coupon_doc.get("first_order_only") and user_id:
                if orders_col.count_documents({"user_id": ObjectId(user_id)}) > 0: 
                    valid = False
            
            if valid:
                c_val = float(coupon_doc.get("value", 0))
                c_max = float(coupon_doc.get("max_discount", 999999))
                if coupon_doc["type"] == "percent":
                    coupon_discount = (c_val / 100.0) * total
                    if coupon_discount > c_max:
                        coupon_discount = c_max
                elif coupon_doc["type"] == "flat":
                    coupon_discount = c_val
                if coupon_discount > total: 
                    coupon_discount = total
                total -= coupon_discount

    # Loyalty Points Usage
    points_used = 0
    points_discount = 0
    earned_points = 0
    if user_id:
        user = users_col.find_one({"_id": ObjectId(user_id)})
        if user and data.get("use_points") and user.get("fc_points", 0) > 0:
            user_points = user["fc_points"]
            max_discount = user_points / 10.0 # 10 points = 1 INR
            if max_discount > total:
                points_discount = total
                points_used = int(total * 10)
            else:
                points_discount = max_discount
                points_used = user_points
            total -= points_discount
            users_col.update_one({"_id": ObjectId(user_id)}, {"$inc": {"fc_points": -points_used}})
            
        # Earn points on final total
        earned_points = int(total // 10)
        if earned_points > 0:
            users_col.update_one({"_id": ObjectId(user_id)}, {"$inc": {"fc_points": earned_points}})

    order_doc = {
        "user_id": ObjectId(user_id) if user_id else "guest",
        "restaurant_id": rid,
        "items": enriched,
        "subtotal": round(original_total, 2),
        "restaurant_discount": round(restaurant_discount, 2),
        "coupon_code": coupon_code if coupon_discount > 0 else "",
        "coupon_discount": round(coupon_discount, 2),
        "total_price": round(total, 2),
        "points_used": points_used,
        "points_discount": round(points_discount, 2),
        "earned_points": earned_points,
        "address": address,
        "status": "pending",
        "created_at": datetime.utcnow() + timedelta(hours=5, minutes=30),
        "payment": {
            "razorpay_order_id": razorpay_order_id,
            "razorpay_payment_id": razorpay_payment_id,
            "paid": True
        }
    }

    # Add mobile number if provided for WhatsApp bill
    if mobile_number:
        order_doc["customer_mobile"] = mobile_number

    if table_number is not None:
        order_doc["table_number"] = table_number
        order_doc["order_type"] = "dine-in"
    else:
        order_doc["order_type"] = "delivery"

    order_id = orders_col.insert_one(order_doc).inserted_id
    return jsonify({"message": "Payment verified & order placed!", "order_id": str(order_id)}), 201


# ── Send Bill via WhatsApp ──────────────────────────────────────────────────────
@customer_bp.route("/api/order/<order_id>/send-whatsapp-bill", methods=["POST"])
@jwt_required(optional=True)
def send_whatsapp_bill(order_id):
    """Send bill to customer via WhatsApp"""
    try:
        oid = ObjectId(order_id)
    except Exception:
        return jsonify({"error": "Invalid order id"}), 400
    
    order = orders_col.find_one({"_id": oid})
    if not order:
        return jsonify({"error": "Order not found"}), 404
    
    mobile = order.get("customer_mobile", "").strip()
    if not mobile:
        return jsonify({"error": "No mobile number found for this order"}), 400
    
    # Validate mobile number format (10 digits or international format)
    mobile = re.sub(r"\D", "", mobile)  # Remove non-digits
    if len(mobile) < 10:
        return jsonify({"error": "Invalid mobile number"}), 400
    
    # Ensure Indian format: add +91 if needed
    if not mobile.startswith("91") and len(mobile) == 10:
        mobile = "91" + mobile
    elif len(mobile) == 12 and mobile.startswith("91"):
        pass  # Already in correct format
    else:
        return jsonify({"error": "Invalid mobile number format"}), 400
    
    mobile_with_code = "+" + mobile
    
    # Build bill message
    rest = restaurants_col.find_one({"_id": order.get("restaurant_id")})
    rest_name = rest.get("name", "Restaurant") if rest else "Restaurant"
    
    bill_text = f"""🧾 *FoodCourt Order Receipt*

Restaurant: {rest_name}
Order ID: {order_id}

*Items:*
"""
    
    for item in order.get("items", []):
        bill_text += f"• {item.get('name', 'Item')} x{item.get('quantity', 0)} = ₹{item.get('price', 0) * item.get('quantity', 0)}\n"
    
    bill_text += f"""
*Subtotal:* ₹{order.get('total_price', 0) + order.get('points_discount', 0) + order.get('coupon_discount', 0)}
*Discount:* -₹{order.get('points_discount', 0) + order.get('coupon_discount', 0)}
*Total:* ₹{order.get('total_price', 0)}

Status: {order.get('status', 'Pending').upper()}
Thank you for ordering! 🙏"""
    
    # Try to send via WhatsApp Business API (if configured)
    whatsapp_token = os.getenv("WHATSAPP_API_TOKEN", "")
    whatsapp_phone_id = os.getenv("WHATSAPP_PHONE_ID", "")
    
    if whatsapp_token and whatsapp_phone_id:
        try:
            url = f"https://graph.instagram.com/v18.0/{whatsapp_phone_id}/messages"
            headers = {
                "Authorization": f"Bearer {whatsapp_token}",
                "Content-Type": "application/json"
            }
            payload = {
                "messaging_product": "whatsapp",
                "to": mobile_with_code,
                "type": "text",
                "text": {"body": bill_text}
            }
            response = requests.post(url, json=payload, headers=headers, timeout=10)
            if response.status_code in [200, 201]:
                return jsonify({"message": f"Bill sent to {mobile_with_code} via WhatsApp"}), 200
        except Exception as e:
            # Log error but don't fail - WhatsApp is optional
            print(f"WhatsApp API error: {str(e)}")
    
    # Fallback message if WhatsApp not configured
    return jsonify({
        "message": "WhatsApp integration not configured. Bill details available in app.",
        "bill_preview": bill_text
    }), 200
