from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime
from backend.db import users_col, restaurants_col, orders_col, menu_col
from backend.utils.auth_helper import role_required

admin_bp = Blueprint("admin", __name__)


def _user(u):
    u["_id"] = str(u["_id"])
    u.pop("password", None)
    return u


def _rest(r):
    r["_id"] = str(r["_id"])
    r.pop("password", None)
    return r


def _order(o):
    o["_id"] = str(o["_id"])
    o["user_id"] = str(o["user_id"])
    o["restaurant_id"] = str(o["restaurant_id"])
    o["created_at"] = o["created_at"].isoformat() if isinstance(o.get("created_at"), datetime) else ""
    for item in o.get("items", []):
        item["item_id"] = str(item.get("item_id", ""))
    return o


# ── Users ───────────────────────────────────────────────────────────────────────
@admin_bp.route("/api/admin/users", methods=["GET"])
@role_required("admin")
def list_users():
    users = list(users_col.find({}))
    return jsonify([_user(u) for u in users]), 200


@admin_bp.route("/api/admin/user/<user_id>", methods=["DELETE"])
@role_required("admin")
def delete_user(user_id):
    try:
        uid = ObjectId(user_id)
    except Exception:
        return jsonify({"error": "Invalid user id"}), 400
    users_col.delete_one({"_id": uid})
    return jsonify({"message": "User deleted"}), 200


# ── Restaurants ─────────────────────────────────────────────────────────────────
@admin_bp.route("/api/admin/restaurants", methods=["GET"])
@role_required("admin")
def list_restaurants():
    rests = list(restaurants_col.find({}))
    result = []
    for r in rests:
        d = _rest(r)
        # Calculate revenue for this restaurant directly from orders collection
        revenue = sum(
            o.get("total_price", 0) for o in orders_col.find({
                "restaurant_id": ObjectId(d["_id"]),
                "status": {"$in": ["accepted", "preparing", "ready", "delivered"]}
            })
        )
        d["total_revenue"] = revenue
        result.append(d)
    return jsonify(result), 200


@admin_bp.route("/api/admin/restaurant/<rest_id>", methods=["PUT"])
@role_required("admin")
def toggle_restaurant(rest_id):
    try:
        rid = ObjectId(rest_id)
    except Exception:
        return jsonify({"error": "Invalid restaurant id"}), 400

    data = request.get_json()
    updates = {}
    if "approved" in data:
        updates["approved"] = bool(data["approved"])

    restaurants_col.update_one({"_id": rid}, {"$set": updates})
    return jsonify({"message": "Restaurant updated"}), 200


@admin_bp.route("/api/admin/restaurant/<rest_id>", methods=["DELETE"])
@role_required("admin")
def delete_restaurant(rest_id):
    try:
        rid = ObjectId(rest_id)
    except Exception:
        return jsonify({"error": "Invalid restaurant id"}), 400
    restaurants_col.delete_one({"_id": rid})
    menu_col.delete_many({"restaurant_id": rid})
    return jsonify({"message": "Restaurant and its menu deleted"}), 200


# ── Orders ──────────────────────────────────────────────────────────────────────
@admin_bp.route("/api/admin/orders", methods=["GET"])
@role_required("admin")
def list_orders():
    raw = list(orders_col.find({"order_type": {"$ne": "service-request"}}).sort("created_at", -1).limit(200))
    result = []
    for o in raw:
        d = _order(o)
        rest = restaurants_col.find_one({"_id": ObjectId(d["restaurant_id"])}, {"name": 1})
        d["restaurant_name"] = rest["name"] if rest else "Unknown"
        result.append(d)
    return jsonify(result), 200


# ── Global Stats ─────────────────────────────────────────────────────────────────
@admin_bp.route("/api/admin/stats", methods=["GET"])
@role_required("admin")
def stats():
    total_users = users_col.count_documents({})
    total_restaurants = restaurants_col.count_documents({})
    total_orders = orders_col.count_documents({"order_type": {"$ne": "service-request"}})
    revenue = sum(o.get("total_price", 0) for o in orders_col.find({
        "status": {"$nin": ["rejected"]},
        "order_type": {"$ne": "service-request"}
    }, {"total_price": 1}))
    return jsonify({
        "total_users": total_users,
        "total_restaurants": total_restaurants,
        "total_orders": total_orders,
        "total_revenue": revenue
    }), 200


# ── Per-Restaurant Revenue Stats ────────────────────────────────────────────────
@admin_bp.route("/api/admin/revenue-stats", methods=["GET"])
@role_required("admin")
def revenue_stats():
    rests = list(restaurants_col.find({}, {"name": 1}))
    result = []
    for r in rests:
        rid = r["_id"]
        orders = list(orders_col.find({
            "restaurant_id": rid,
            "status": {"$in": ["accepted", "preparing", "ready", "delivered"]},
            "order_type": {"$ne": "service-request"}
        }, {"total_price": 1}))
        revenue = sum(o.get("total_price", 0) for o in orders)
        order_count = len(orders)
        result.append({
            "_id": str(rid),
            "name": r.get("name", "Unknown"),
            "revenue": round(revenue, 2),
            "order_count": order_count
        })
    # Sort by revenue descending
    result.sort(key=lambda x: x["revenue"], reverse=True)
    return jsonify(result), 200
