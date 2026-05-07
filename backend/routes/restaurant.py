from flask import Blueprint, request, jsonify
from flask_jwt_extended import get_jwt_identity
from bson import ObjectId
from datetime import datetime, timedelta
from backend.db import menu_col, orders_col, restaurants_col, reviews_col, tables_col, coupons_col
from backend.utils.auth_helper import role_required
from backend.utils.upload import save_image

restaurant_bp = Blueprint("restaurant", __name__)

VALID_STATUSES = ["pending", "accepted", "rejected", "preparing", "ready", "delivered"]


def _item_to_dict(i):
    i["_id"] = str(i["_id"])
    i["restaurant_id"] = str(i["restaurant_id"])
    return i


def _order_to_dict(o):
    o["_id"] = str(o["_id"])
    o["user_id"] = str(o["user_id"])
    o["restaurant_id"] = str(o["restaurant_id"])
    o["created_at"] = o["created_at"].isoformat() if isinstance(o.get("created_at"), datetime) else ""
    for item in o.get("items", []):
        item["item_id"] = str(item.get("item_id", ""))
    return o


# ── Dashboard Stats ─────────────────────────────────────────────────────────────
@restaurant_bp.route("/api/restaurant/dashboard", methods=["GET"])
@role_required("restaurant")
def dashboard():
    rest_id = ObjectId(get_jwt_identity())
    orders = list(orders_col.find({"restaurant_id": rest_id}))
    total_orders = len(orders)
    revenue = sum(o.get("total_price", 0) for o in orders if o.get("status") not in ["rejected"])
    pending = sum(1 for o in orders if o.get("status") == "pending")
    accepted = sum(1 for o in orders if o.get("status") == "accepted")
    preparing = sum(1 for o in orders if o.get("status") == "preparing")
    dine_in = sum(1 for o in orders if o.get("order_type") == "dine-in" and o.get("status") not in ["delivered", "rejected"])

    rest = restaurants_col.find_one({"_id": rest_id}, {"password": 0})
    if rest:
        rest["_id"] = str(rest["_id"])

    # Count tables
    table_count = tables_col.count_documents({"restaurant_id": rest_id})

    return jsonify({
        "total_orders": total_orders,
        "revenue": revenue,
        "pending": pending,
        "accepted": accepted,
        "preparing": preparing,
        "dine_in_active": dine_in,
        "table_count": table_count,
        "restaurant": rest
    }), 200


# ── Revenue Data for Chart ──────────────────────────────────────────────────────
@restaurant_bp.route("/api/restaurant/revenue_data", methods=["GET"])
@role_required("restaurant")
def revenue_data():
    rest_id = ObjectId(get_jwt_identity())
    
    # Get orders from last 7 days
    sevendays_ago = datetime.utcnow() - timedelta(days=6)
    sevendays_ago = sevendays_ago.replace(hour=0, minute=0, second=0, microsecond=0)
    
    orders = list(orders_col.find({
        "restaurant_id": rest_id,
        "created_at": {"$gte": sevendays_ago},
        "status": {"$in": ["accepted", "preparing", "ready", "delivered"]}
    }))
    
    # Group by date string (YYYY-MM-DD)
    daily_revenue = {}
    for i in range(7):
        d = (datetime.utcnow() - timedelta(days=i)).strftime("%Y-%m-%d")
        daily_revenue[d] = 0

    for o in orders:
        if isinstance(o.get("created_at"), datetime):
            d_str = o["created_at"].strftime("%Y-%m-%d")
            if d_str in daily_revenue:
                daily_revenue[d_str] += o.get("total_price", 0)

    # Sort chronological
    labels = sorted(daily_revenue.keys())
    data = [round(daily_revenue[k], 2) for k in labels]
    
    return jsonify({"labels": labels, "data": data}), 200


# ── Top 10 Sold Dishes Analytics ───────────────────────────────────────────────
@restaurant_bp.route("/api/restaurant/top_dishes", methods=["GET"])
@role_required("restaurant")
def top_sold_dishes():
    rest_id = ObjectId(get_jwt_identity())
    
    # Get all delivered/accepted orders for this restaurant
    orders = list(orders_col.find({
        "restaurant_id": rest_id,
        "status": {"$in": ["accepted", "preparing", "ready", "delivered"]}
    }))
    
    # Aggregate dish sales
    dish_stats = {}
    for order in orders:
        for item in order.get("items", []):
            item_id = str(item.get("item_id", ""))
            qty = item.get("quantity", 0)
            price = item.get("price", 0)
            
            if item_id not in dish_stats:
                dish_stats[item_id] = {
                    "name": item.get("name", "Unknown"),
                    "quantity": 0,
                    "revenue": 0
                }
            
            dish_stats[item_id]["quantity"] += qty
            dish_stats[item_id]["revenue"] += qty * price
    
    # Sort by quantity (descending) and get top 10
    sorted_dishes = sorted(dish_stats.items(), key=lambda x: x[1]["quantity"], reverse=True)[:10]
    
    result = []
    for item_id, stats in sorted_dishes:
        result.append({
            "item_id": item_id,
            "name": stats["name"],
            "quantity_sold": stats["quantity"],
            "revenue": round(stats["revenue"], 2)
        })
    
    return jsonify(result), 200


# ── Get Own Menu ────────────────────────────────────────────────────────────────
@restaurant_bp.route("/api/restaurant/menu", methods=["GET"])
@role_required("restaurant")
def get_my_menu():
    rest_id = ObjectId(get_jwt_identity())
    items = list(menu_col.find({"restaurant_id": rest_id}))
    return jsonify([_item_to_dict(i) for i in items]), 200


# ── Add Menu Item ───────────────────────────────────────────────────────────────
@restaurant_bp.route("/api/menu/add", methods=["POST"])
@role_required("restaurant")
def add_menu_item():
    rest_id = ObjectId(get_jwt_identity())
    name = request.form.get("name", "").strip()
    price = request.form.get("price")
    available = request.form.get("available", "true").lower() == "true"

    if not name or not price:
        return jsonify({"error": "name and price are required"}), 400

    image_url = ""
    if "image" in request.files:
        image_url = save_image(request.files["image"], "menu") or ""

    item_id = menu_col.insert_one({
        "restaurant_id": rest_id,
        "name": name,
        "price": float(price),
        "image": image_url,
        "available": available
    }).inserted_id

    return jsonify({"message": "Menu item added", "item_id": str(item_id)}), 201


# ── Update Menu Item ────────────────────────────────────────────────────────────
@restaurant_bp.route("/api/menu/update/<item_id>", methods=["PUT"])
@role_required("restaurant")
def update_menu_item(item_id):
    rest_id = ObjectId(get_jwt_identity())
    try:
        iid = ObjectId(item_id)
    except Exception:
        return jsonify({"error": "Invalid item id"}), 400

    item = menu_col.find_one({"_id": iid, "restaurant_id": rest_id})
    if not item:
        return jsonify({"error": "Item not found or unauthorized"}), 404

    updates = {}
    if request.content_type and "multipart" in request.content_type:
        if request.form.get("name"):
            updates["name"] = request.form.get("name").strip()
        if request.form.get("price"):
            updates["price"] = float(request.form.get("price"))
        if request.form.get("available") is not None:
            updates["available"] = request.form.get("available").lower() == "true"
        if "image" in request.files:
            url = save_image(request.files["image"], "menu")
            if url:
                updates["image"] = url
    else:
        data = request.get_json() or {}
        if "name" in data:
            updates["name"] = data["name"].strip()
        if "price" in data:
            updates["price"] = float(data["price"])
        if "available" in data:
            updates["available"] = bool(data["available"])

    if not updates:
        return jsonify({"error": "No fields to update"}), 400

    menu_col.update_one({"_id": iid}, {"$set": updates})
    return jsonify({"message": "Menu item updated"}), 200


# ── Delete Menu Item ────────────────────────────────────────────────────────────
@restaurant_bp.route("/api/menu/delete/<item_id>", methods=["DELETE"])
@role_required("restaurant")
def delete_menu_item(item_id):
    rest_id = ObjectId(get_jwt_identity())
    try:
        iid = ObjectId(item_id)
    except Exception:
        return jsonify({"error": "Invalid item id"}), 400

    result = menu_col.delete_one({"_id": iid, "restaurant_id": rest_id})
    if result.deleted_count == 0:
        return jsonify({"error": "Item not found or unauthorized"}), 404
    return jsonify({"message": "Menu item deleted"}), 200


# ── Get Restaurant's Orders ─────────────────────────────────────────────────────
@restaurant_bp.route("/api/restaurant/orders", methods=["GET"])
@role_required("restaurant")
def get_restaurant_orders():
    rest_id = ObjectId(get_jwt_identity())
    status_filter = request.args.get("status")
    filt = {"restaurant_id": rest_id}
    if status_filter:
        filt["status"] = status_filter

    raw = list(orders_col.find(filt).sort("created_at", -1))
    return jsonify([_order_to_dict(o) for o in raw]), 200


# ── Update Order Status ─────────────────────────────────────────────────────────
@restaurant_bp.route("/api/order/status/<order_id>", methods=["PUT"])
@role_required("restaurant")
def update_order_status(order_id):
    rest_id = ObjectId(get_jwt_identity())
    try:
        oid = ObjectId(order_id)
    except Exception:
        return jsonify({"error": "Invalid order id"}), 400

    data = request.get_json()
    new_status = data.get("status", "").lower()
    if new_status not in VALID_STATUSES:
        return jsonify({"error": f"Invalid status. Must be one of: {VALID_STATUSES}"}), 400

    result = orders_col.update_one(
        {"_id": oid, "restaurant_id": rest_id},
        {"$set": {"status": new_status, "updated_at": datetime.utcnow()}}
    )
    if result.matched_count == 0:
        return jsonify({"error": "Order not found or unauthorized"}), 404
    return jsonify({"message": f"Order status updated to {new_status}"}), 200


# ── Upload Restaurant Image ─────────────────────────────────────────────────────
@restaurant_bp.route("/api/restaurant/upload", methods=["POST"])
@role_required("restaurant")
def upload_image():
    rest_id = ObjectId(get_jwt_identity())
    if "image" not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    url = save_image(request.files["image"], "restaurants")
    if not url:
        return jsonify({"error": "Invalid file type"}), 400

    restaurants_col.update_one({"_id": rest_id}, {"$set": {"image": url}})
    return jsonify({"message": "Image uploaded", "url": url}), 200

# ── Update Restaurant Offer ───────────────────────────────────────────────────
@restaurant_bp.route("/api/restaurant/offer", methods=["POST"])
@role_required("restaurant")
def update_offer():
    rest_id = ObjectId(get_jwt_identity())
    data = request.get_json() or {}
    offer_text = data.get("offer", "").strip()
    discount_pct = data.get("discount_pct", 0)
    allow_coupons = data.get("allow_coupons", True)  # Default to true for backward compatibility

    restaurants_col.update_one({"_id": rest_id}, {"$set": {
        "offer": offer_text,
        "discount_pct": float(discount_pct),
        "allow_coupons": allow_coupons
    }})
    return jsonify({"message": "Offer updated successfully"}), 200


# ══════════════════════════════════════════════════════════════════════════════
# COUPON MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════════

# ── Get All Coupons for Restaurant ──────────────────────────────────────────────
@restaurant_bp.route("/api/restaurant/coupons", methods=["GET"])
@role_required("restaurant")
def get_restaurant_coupons():
    rest_id = ObjectId(get_jwt_identity())
    coupons = list(coupons_col.find({"restaurant_id": rest_id}).sort("created_at", -1))
    
    result = []
    for c in coupons:
        c["_id"] = str(c["_id"])
        c["restaurant_id"] = str(c["restaurant_id"])
        result.append(c)
    
    return jsonify(result), 200


# ── Create New Coupon ───────────────────────────────────────────────────────────
@restaurant_bp.route("/api/restaurant/coupon", methods=["POST"])
@role_required("restaurant")
def create_coupon():
    rest_id = ObjectId(get_jwt_identity())
    data = request.get_json() or {}
    
    code = data.get("code", "").upper().strip()
    coupon_type = data.get("type", "percent")  # percent or flat
    value = float(data.get("value", 0))
    max_discount = float(data.get("max_discount", 999999))
    min_order = float(data.get("min_order", 0))
    first_order_only = bool(data.get("first_order_only", False))
    enabled = bool(data.get("enabled", True))
    
    if not code or value <= 0:
        return jsonify({"error": "Code and value are required and must be positive"}), 400
    
    if coupon_type not in ["percent", "flat"]:
        return jsonify({"error": "Type must be 'percent' or 'flat'"}), 400
    
    # Check if coupon already exists
    existing = coupons_col.find_one({
        "restaurant_id": rest_id,
        "code": code
    })
    
    if existing:
        return jsonify({"error": "Coupon with this code already exists"}), 409
    
    coupon_doc = {
        "restaurant_id": rest_id,
        "code": code,
        "type": coupon_type,
        "value": value,
        "max_discount": max_discount,
        "min_order": min_order,
        "first_order_only": first_order_only,
        "enabled": enabled,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    
    result = coupons_col.insert_one(coupon_doc)
    coupon_doc["_id"] = str(result.inserted_id)
    coupon_doc["restaurant_id"] = str(coupon_doc["restaurant_id"])
    
    return jsonify({"message": "Coupon created successfully", "coupon": coupon_doc}), 201


# ── Update Coupon ───────────────────────────────────────────────────────────────
@restaurant_bp.route("/api/restaurant/coupon/<coupon_id>", methods=["PUT"])
@role_required("restaurant")
def update_coupon(coupon_id):
    rest_id = ObjectId(get_jwt_identity())
    
    try:
        cid = ObjectId(coupon_id)
    except Exception:
        return jsonify({"error": "Invalid coupon id"}), 400
    
    data = request.get_json() or {}
    
    coupon = coupons_col.find_one({"_id": cid, "restaurant_id": rest_id})
    if not coupon:
        return jsonify({"error": "Coupon not found or unauthorized"}), 404
    
    updates = {}
    if "code" in data:
        updates["code"] = data["code"].upper().strip()
    if "value" in data:
        updates["value"] = float(data["value"])
    if "max_discount" in data:
        updates["max_discount"] = float(data["max_discount"])
    if "min_order" in data:
        updates["min_order"] = float(data["min_order"])
    if "first_order_only" in data:
        updates["first_order_only"] = bool(data["first_order_only"])
    if "enabled" in data:
        updates["enabled"] = bool(data["enabled"])
    
    if not updates:
        return jsonify({"error": "No fields to update"}), 400
    
    updates["updated_at"] = datetime.utcnow()
    
    coupons_col.update_one({"_id": cid}, {"$set": updates})
    return jsonify({"message": "Coupon updated successfully"}), 200


# ── Delete Coupon ───────────────────────────────────────────────────────────────
@restaurant_bp.route("/api/restaurant/coupon/<coupon_id>", methods=["DELETE"])
@role_required("restaurant")
def delete_coupon(coupon_id):
    rest_id = ObjectId(get_jwt_identity())
    
    try:
        cid = ObjectId(coupon_id)
    except Exception:
        return jsonify({"error": "Invalid coupon id"}), 400
    
    result = coupons_col.delete_one({"_id": cid, "restaurant_id": rest_id})
    
    if result.deleted_count == 0:
        return jsonify({"error": "Coupon not found or unauthorized"}), 404
    
    return jsonify({"message": "Coupon deleted successfully"}), 200


# ══════════════════════════════════════════════════════════════════════════════
# TABLE MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════════

# ── Create / Generate Tables ────────────────────────────────────────────────────
@restaurant_bp.route("/api/restaurant/tables", methods=["POST"])
@role_required("restaurant")
def create_tables():
    rest_id = ObjectId(get_jwt_identity())
    data = request.get_json() or {}
    count = int(data.get("count", 1))

    if count < 1 or count > 50:
        return jsonify({"error": "Count must be between 1 and 50"}), 400

    # Find the highest existing table number
    last_table = tables_col.find_one(
        {"restaurant_id": rest_id},
        sort=[("table_number", -1)]
    )
    start_num = (last_table["table_number"] + 1) if last_table else 1

    created = []
    for i in range(count):
        t_num = start_num + i
        tables_col.insert_one({
            "restaurant_id": rest_id,
            "table_number": t_num,
            "status": "available",
            "created_at": datetime.utcnow()
        })
        created.append(t_num)

    return jsonify({
        "message": f"{count} table(s) created",
        "tables": created
    }), 201


# ── List Tables ─────────────────────────────────────────────────────────────────
@restaurant_bp.route("/api/restaurant/tables", methods=["GET"])
@role_required("restaurant")
def list_tables():
    rest_id = ObjectId(get_jwt_identity())
    tables = list(tables_col.find({"restaurant_id": rest_id}).sort("table_number", 1))

    result = []
    for t in tables:
        # Check if there are active orders for this table
        active_orders = orders_col.count_documents({
            "restaurant_id": rest_id,
            "table_number": t["table_number"],
            "status": {"$in": ["pending", "accepted", "preparing", "ready"]}
        })
        result.append({
            "_id": str(t["_id"]),
            "table_number": t["table_number"],
            "status": "occupied" if active_orders > 0 else "available",
            "active_orders": active_orders
        })

    return jsonify(result), 200


# ── Delete a Table ──────────────────────────────────────────────────────────────
@restaurant_bp.route("/api/restaurant/table/<int:table_number>", methods=["DELETE"])
@role_required("restaurant")
def delete_table(table_number):
    rest_id = ObjectId(get_jwt_identity())
    result = tables_col.delete_one({"restaurant_id": rest_id, "table_number": table_number})
    if result.deleted_count == 0:
        return jsonify({"error": "Table not found"}), 404
    return jsonify({"message": f"Table {table_number} deleted"}), 200

# ══════════════════════════════════════════════════════════════════════════════
# AI ANALYST
# ══════════════════════════════════════════════════════════════════════════════

import requests
import json
import os
from backend.config import Config

@restaurant_bp.route("/api/restaurant/ai-analyst", methods=["POST"])
@role_required("restaurant")
def ai_analyst():
    rest_id = ObjectId(get_jwt_identity())
    data = request.get_json() or {}
    query = data.get("query", "").strip()

    if not query:
        return jsonify({"error": "Query is required"}), 400

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return jsonify({
            "response": "⚠️ **Missing Gemini API Key!**\n\nTo use the AI Analyst, please add `GEMINI_API_KEY=your_actual_api_key` to the `.env` file and restart the server. You can get a free key from Google AI Studio."
        }), 200

    # Gather context data
    rest = restaurants_col.find_one({"_id": rest_id}, {"password": 0})
    orders = list(orders_col.find({"restaurant_id": rest_id}))
    reviews = list(reviews_col.find({"restaurant_id": rest_id}))

    total_revenue = sum(o.get("total_price", 0) for o in orders if o.get("status") not in ["rejected", "cancelled"])
    total_orders = len(orders)
    dine_in_orders = sum(1 for o in orders if o.get("order_type") == "dine-in")
    delivery_orders = total_orders - dine_in_orders

    avg_rating = rest.get("rating", 0)
    total_ratings = rest.get("totalRatings", 0)

    # Convert to concise string to avoid massive prompts
    context = f"""
    Restaurant Name: {rest.get('name', 'Unknown')}
    Cuisine: {rest.get('cuisine', 'Unknown')}
    Total Revenue: ₹{total_revenue}
    Total Orders: {total_orders} ({dine_in_orders} Dine-in, {delivery_orders} Delivery)
    Average Rating: {avg_rating} ⭐ from {total_ratings} reviews.
    
    Recent Reviews Sample:
    """
    for r in reviews[-5:]:
        context += f"- {r.get('rating')}⭐: {r.get('comment')}\n"

    prompt = f"""
    You are an expert AI Restaurant Business Analyst.
    Use the following real-time data about the user's restaurant to answer their query.
    Keep the answer highly actionable, concise, and beautifully formatted in Markdown.
    If the data doesn't contain the exact answer, make reasonable suggestions based on general restaurant best practices.
    
    Data:
    {context}
    
    User Query: {query}
    """

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    headers = {"Content-Type": "application/json"}
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 1000
        }
    }

    try:
        r = requests.post(url, headers=headers, json=payload, timeout=10)
        r_json = r.json()
        if r.status_code == 200:
            text = r_json["candidates"][0]["content"]["parts"][0]["text"]
            return jsonify({"response": text}), 200
        else:
            return jsonify({"response": f"⚠️ **API Error:** {r_json.get('error', {}).get('message', 'Unknown error')}"}), 200
    except Exception as e:
        return jsonify({"response": f"⚠️ **Connection Error:** Failed to connect to Gemini API. {str(e)}"}), 200
