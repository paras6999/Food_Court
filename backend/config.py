import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017/")
    DB_NAME = os.getenv("DB_NAME", "foodcourt")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-me-in-production")
    UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER", "static/uploads")
    MAX_CONTENT_LENGTH = int(os.getenv("MAX_CONTENT_LENGTH", 16 * 1024 * 1024))
    ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@foodcourt.com")
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
    JWT_ACCESS_TOKEN_EXPIRES = False   # tokens don't expire for demo; set a timedelta in prod
    CORS_ORIGINS = "*"
    GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "77957118883-n0f61t165nj05m29q01k953rb3q7afun.apps.googleusercontent.com")
    RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "rzp_test_SlogHzYu5J3vLW")
    RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "njkgSVay1Jrhbrgh60a8Vtee")
