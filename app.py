import os
import sys

# Make sure the project root is on the Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, send_from_directory
from flask_jwt_extended import JWTManager
from flask_cors import CORS
from backend.config import Config
from backend.routes.auth import auth_bp
from backend.routes.customer import customer_bp
from backend.routes.restaurant import restaurant_bp
from backend.routes.admin import admin_bp

app = Flask(__name__, template_folder="templates", static_folder="static")

# Config
app.config["JWT_SECRET_KEY"] = Config.JWT_SECRET_KEY
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = Config.JWT_ACCESS_TOKEN_EXPIRES
app.config["UPLOAD_FOLDER"] = Config.UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = Config.MAX_CONTENT_LENGTH

# Extensions
JWTManager(app)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Register blueprints
app.register_blueprint(auth_bp)
app.register_blueprint(customer_bp)
app.register_blueprint(restaurant_bp)
app.register_blueprint(admin_bp)

# Ensure upload directory exists
os.makedirs(os.path.join(app.root_path, Config.UPLOAD_FOLDER, "restaurants"), exist_ok=True)
os.makedirs(os.path.join(app.root_path, Config.UPLOAD_FOLDER, "menu"), exist_ok=True)


# ── Serve frontend pages ───────────────────────────────────────────────────────
@app.route("/")
def index():
    return send_from_directory("templates", "index.html")

@app.route("/<path:page>.html")
def serve_page(page):
    try:
        return send_from_directory("templates", f"{page}.html")
    except Exception:
        return send_from_directory("templates", "index.html")


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
