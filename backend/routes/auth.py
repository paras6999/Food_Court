from flask import Blueprint, request, jsonify
from backend.db import users_col, restaurants_col
from backend.utils.auth_helper import hash_password, check_password, generate_token
from backend.config import Config
from google.oauth2 import id_token
from google.auth.transport import requests

auth_bp = Blueprint("auth", __name__)

# ── Google Auth ─────────────────────────────────────────────────────────────────
@auth_bp.route("/api/auth/google", methods=["POST"])
def google_auth():
    data = request.get_json()
    token = data.get("credential")
    
    if not token:
        return jsonify({"error": "No credential provided"}), 400
        
    try:
        # Verify the token
        client_id = Config.GOOGLE_CLIENT_ID
        idinfo = id_token.verify_oauth2_token(token, requests.Request(), client_id)
        
        # ID token is valid. Get the user's Google Account ID and email.
        email = idinfo.get('email').lower()
        name = idinfo.get('name', 'Google User')
        
        # Check if user exists
        user = users_col.find_one({"email": email})
        
        if not user:
            # Register new user
            user_id = str(users_col.insert_one({
                "name": name,
                "email": email,
                "password": "", # No password for Google Auth users
                "role": "customer",
                "auth_provider": "google"
            }).inserted_id)
        else:
            user_id = str(user["_id"])
            name = user.get("name", name)
            
        jwt_token = generate_token(user_id, {"role": "customer", "name": name, "email": email})
        return jsonify({"token": jwt_token, "role": "customer", "name": name, "id": user_id}), 200
        
    except ValueError as e:
        # Invalid token
        return jsonify({"error": "Invalid Google token"}), 401


# ── Customer Register ──────────────────────────────────────────────────────────
@auth_bp.route("/api/register", methods=["POST"])
def customer_register():
    data = request.get_json()
    name = data.get("name", "").strip()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not name or not email or not password:
        return jsonify({"error": "All fields are required"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    if users_col.find_one({"email": email}):
        return jsonify({"error": "Email already registered"}), 409

    user_id = str(users_col.insert_one({
        "name": name,
        "email": email,
        "password": hash_password(password),
        "role": "customer"
    }).inserted_id)

    token = generate_token(user_id, {"role": "customer", "name": name, "email": email})
    return jsonify({"token": token, "role": "customer", "name": name, "id": user_id}), 201


# ── Customer Login ──────────────────────────────────────────────────────────────
@auth_bp.route("/api/login", methods=["POST"])
def customer_login():
    data = request.get_json()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    user = users_col.find_one({"email": email})
    if not user or not check_password(password, user["password"]):
        return jsonify({"error": "Invalid email or password"}), 401

    user_id = str(user["_id"])
    token = generate_token(user_id, {"role": user.get("role", "customer"), "name": user["name"], "email": email})
    return jsonify({"token": token, "role": user.get("role", "customer"), "name": user["name"], "id": user_id}), 200


# ── Restaurant Register ─────────────────────────────────────────────────────────
@auth_bp.route("/api/restaurant/register", methods=["POST"])
def restaurant_register():
    data = request.get_json()
    name = data.get("name", "").strip()
    owner = data.get("ownerName", "").strip()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")
    cuisine = data.get("cuisine", "").strip()

    if not name or not email or not password or not owner:
        return jsonify({"error": "All fields are required"}), 400
    if restaurants_col.find_one({"email": email}):
        return jsonify({"error": "Email already registered"}), 409

    rest_id = str(restaurants_col.insert_one({
        "name": name,
        "ownerName": owner,
        "email": email,
        "password": hash_password(password),
        "cuisine": cuisine,
        "rating": 0.0,
        "totalRatings": 0,
        "image": "",
        "approved": True,
        "role": "restaurant"
    }).inserted_id)

    token = generate_token(rest_id, {"role": "restaurant", "name": name, "email": email})
    return jsonify({"token": token, "role": "restaurant", "name": name, "id": rest_id}), 201


# ── Restaurant Login ────────────────────────────────────────────────────────────
@auth_bp.route("/api/restaurant/login", methods=["POST"])
def restaurant_login():
    data = request.get_json()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    rest = restaurants_col.find_one({"email": email})
    if not rest or not check_password(password, rest["password"]):
        return jsonify({"error": "Invalid email or password"}), 401

    rest_id = str(rest["_id"])
    token = generate_token(rest_id, {"role": "restaurant", "name": rest["name"], "email": email})
    return jsonify({"token": token, "role": "restaurant", "name": rest["name"], "id": rest_id}), 200


# ── Admin Login ─────────────────────────────────────────────────────────────────
@auth_bp.route("/api/admin/login", methods=["POST"])
def admin_login():
    data = request.get_json()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if email != Config.ADMIN_EMAIL or password != Config.ADMIN_PASSWORD:
        return jsonify({"error": "Invalid admin credentials"}), 401

    token = generate_token("admin", {"role": "admin", "name": "Admin", "email": email})
    return jsonify({"token": token, "role": "admin", "name": "Admin", "id": "admin"}), 200
