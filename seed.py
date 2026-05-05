"""
seed.py — Populate MongoDB with sample data for development/testing.
Run: python seed.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from datetime import datetime
from bson import ObjectId
from backend.db import users_col, restaurants_col, menu_col, orders_col, reviews_col, tables_col
from backend.utils.auth_helper import hash_password

print("🌱 Seeding Food Court database...")

# Clear existing data
for col in [users_col, restaurants_col, menu_col, orders_col, reviews_col, tables_col]:
    col.delete_many({})

# ── Users ──────────────────────────────────────────────────────────────
user1_id = users_col.insert_one({
    "name": "Alice Johnson",
    "email": "alice@example.com",
    "password": hash_password("pass123"),
    "role": "customer"
}).inserted_id

user2_id = users_col.insert_one({
    "name": "Bob Smith",
    "email": "bob@example.com",
    "password": hash_password("pass123"),
    "role": "customer"
}).inserted_id

print(f"  ✅ Created 2 customers")

# ── Restaurants ────────────────────────────────────────────────────────
pizza_id = restaurants_col.insert_one({
    "name": "Pizza Hub",
    "ownerName": "Marco Rossi",
    "email": "pizza@hub.com",
    "password": hash_password("pass123"),
    "cuisine": "Italian",
    "rating": 4.5,
    "totalRatings": 12,
    "image": "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400",
    "approved": True,
    "role": "restaurant"
}).inserted_id

burger_id = restaurants_col.insert_one({
    "name": "Burger Barn",
    "ownerName": "Jake Williams",
    "email": "burger@barn.com",
    "password": hash_password("pass123"),
    "cuisine": "American",
    "rating": 4.2,
    "totalRatings": 8,
    "image": "https://images.unsplash.com/photo-1550547660-d9450f859349?w=400",
    "approved": True,
    "role": "restaurant"
}).inserted_id

sushi_id = restaurants_col.insert_one({
    "name": "Sushi Zen",
    "ownerName": "Kenji Tanaka",
    "email": "sushi@zen.com",
    "password": hash_password("pass123"),
    "cuisine": "Japanese",
    "rating": 4.8,
    "totalRatings": 20,
    "image": "https://images.unsplash.com/photo-1563612116625-3012372fccce?w=400",
    "approved": True,
    "role": "restaurant"
}).inserted_id

print(f"  ✅ Created 3 restaurants")

# ── Menu Items ─────────────────────────────────────────────────────────
pizza_items = [
    {"name": "Margherita Pizza",  "price": 249, "image": "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=300"},
    {"name": "Pepperoni Pizza",   "price": 299, "image": "https://images.unsplash.com/photo-1628840042765-356cda07504e?w=300"},
    {"name": "BBQ Chicken Pizza", "price": 349, "image": "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=300"},
    {"name": "Garlic Bread",      "price": 99,  "image": "https://images.unsplash.com/photo-1619985648870-a33f979fa994?w=300"},
    {"name": "Caesar Salad",      "price": 179, "image": "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=300"},
]
burger_items = [
    {"name": "Classic Burger",    "price": 199, "image": "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=300"},
    {"name": "Double Smash Burger","price": 299, "image": "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=300"},
    {"name": "Crispy Chicken",    "price": 249, "image": "https://images.unsplash.com/photo-1606755962773-d324e0a13086?w=300"},
    {"name": "Cheese Fries",      "price": 129, "image": "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=300"},
    {"name": "Chocolate Shake",   "price": 149, "image": "https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=300"},
]
sushi_items = [
    {"name": "Salmon Nigiri (8pc)","price": 449, "image": "https://images.unsplash.com/photo-1617196034183-421b4040ed20?w=300"},
    {"name": "Dragon Roll",       "price": 499, "image": "https://images.unsplash.com/photo-1562802378-063ec186a863?w=300"},
    {"name": "Miso Soup",         "price": 99,  "image": "https://images.unsplash.com/photo-1547592400-8c0df8e3e5aa?w=300"},
    {"name": "Edamame",           "price": 129, "image": "https://images.unsplash.com/photo-1534482421-64566f976cfa?w=300"},
    {"name": "Matcha Ice Cream",  "price": 149, "image": "https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=300"},
]

item_ids = {}
for rest_id, items in [(pizza_id, pizza_items), (burger_id, burger_items), (sushi_id, sushi_items)]:
    for item in items:
        iid = menu_col.insert_one({
            "restaurant_id": rest_id,
            "name": item["name"],
            "price": item["price"],
            "image": item["image"],
            "available": True
        }).inserted_id
        item_ids[item["name"]] = iid

print(f"  ✅ Created {len(item_ids)} menu items")

# ── Tables ─────────────────────────────────────────────────────────────
table_count = 0
for rest_id, num_tables in [(pizza_id, 8), (burger_id, 6), (sushi_id, 5)]:
    for t in range(1, num_tables + 1):
        tables_col.insert_one({
            "restaurant_id": rest_id,
            "table_number": t,
            "status": "available",
            "created_at": datetime.utcnow()
        })
        table_count += 1

print(f"  ✅ Created {table_count} tables (8 + 6 + 5)")

# ── Sample Orders ──────────────────────────────────────────────────────
# Delivery order
orders_col.insert_one({
    "user_id": user1_id,
    "restaurant_id": pizza_id,
    "items": [
        {"item_id": item_ids["Margherita Pizza"], "name": "Margherita Pizza", "quantity": 2, "price": 249},
        {"item_id": item_ids["Garlic Bread"],      "name": "Garlic Bread",     "quantity": 1, "price": 99},
    ],
    "total_price": 597,
    "address": "123 Main St",
    "order_type": "delivery",
    "status": "pending",
    "created_at": datetime.utcnow()
})

# Dine-in order from Table 3
orders_col.insert_one({
    "user_id": user2_id,
    "restaurant_id": burger_id,
    "items": [
        {"item_id": item_ids["Classic Burger"],  "name": "Classic Burger",  "quantity": 1, "price": 199},
        {"item_id": item_ids["Cheese Fries"],    "name": "Cheese Fries",    "quantity": 2, "price": 129},
    ],
    "total_price": 457,
    "address": "Dine-In — Table 3",
    "table_number": 3,
    "order_type": "dine-in",
    "status": "preparing",
    "created_at": datetime.utcnow()
})

# Dine-in order from Table 1 (delivered)
orders_col.insert_one({
    "user_id": user1_id,
    "restaurant_id": pizza_id,
    "items": [
        {"item_id": item_ids["Pepperoni Pizza"], "name": "Pepperoni Pizza", "quantity": 1, "price": 299},
        {"item_id": item_ids["Caesar Salad"],    "name": "Caesar Salad",    "quantity": 1, "price": 179},
    ],
    "total_price": 478,
    "address": "Dine-In — Table 1",
    "table_number": 1,
    "order_type": "dine-in",
    "status": "delivered",
    "created_at": datetime.utcnow()
})

print(f"  ✅ Created 3 sample orders (1 delivery + 2 dine-in)")

# ── Reviews ────────────────────────────────────────────────────────
reviews_col.insert_one({
    "user_id": user1_id,
    "user_name": "Alice Johnson",
    "restaurant_id": pizza_id,
    "rating": 5.0,
    "comment": "Best pizza in town! The Margherita is absolutely delicious.",
    "created_at": datetime.utcnow()
})

print(f"  ✅ Created 1 review")
print()
print("✨ Seeding complete!")
print()
print("  🔑 Test Credentials:")
print("     Admin:      admin@foodcourt.com  / admin123")
print("     Restaurant: pizza@hub.com        / pass123")
print("     Restaurant: burger@barn.com      / pass123")
print("     Customer:   alice@example.com    / pass123")
print()
print("  🪑 Tables Created:")
print("     Pizza Hub:    Tables 1–8")
print("     Burger Barn:  Tables 1–6")
print("     Sushi Zen:    Tables 1–5")
print()
print("  📱 QR Code URL pattern:")
print("     http://localhost:5000/customer_table.html?restaurant=<id>&table=<num>")
