import bcrypt
from flask_jwt_extended import create_access_token, get_jwt_identity, get_jwt
from functools import wraps
from flask import jsonify
from flask_jwt_extended import verify_jwt_in_request


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def check_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def generate_token(identity: str, additional_claims: dict = None) -> str:
    return create_access_token(identity=identity, additional_claims=additional_claims or {})


def role_required(*roles):
    """Decorator that enforces JWT presence and checks the 'role' claim."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            claims = get_jwt()
            if claims.get("role") not in roles:
                return jsonify({"error": "Access forbidden: insufficient role"}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator
