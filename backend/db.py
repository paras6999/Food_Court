from pymongo import MongoClient
from backend.config import Config

client = MongoClient(Config.MONGODB_URI)
db = client[Config.DB_NAME]

users_col = db["users"]
restaurants_col = db["restaurants"]
menu_col = db["menu"]
orders_col = db["orders"]
reviews_col = db["reviews"]
tables_col = db["tables"]
group_carts_col = db["group_carts"]
coupons_col = db["coupons"]

# Ensure indexes for performance
users_col.create_index("email", unique=True)
restaurants_col.create_index("email", unique=True)
menu_col.create_index("restaurant_id")
orders_col.create_index("user_id")
orders_col.create_index("restaurant_id")
tables_col.create_index([("restaurant_id", 1), ("table_number", 1)], unique=True)
coupons_col.create_index([("restaurant_id", 1), ("code", 1)], unique=True)
