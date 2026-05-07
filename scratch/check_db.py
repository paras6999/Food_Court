from backend.db import reviews_col, restaurants_col
from bson import ObjectId

print("--- REVIEWS COLLECTION ---")
reviews = list(reviews_col.find())
print(f"Total reviews: {len(reviews)}")
for r in reviews:
    print(f"ID: {r['_id']}, Restaurant: {r.get('restaurant_id')}, User: {r.get('user_name')}, Rating: {r.get('rating')}")

print("\n--- RESTAURANTS COLLECTION ---")
rests = list(restaurants_col.find())
for rest in rests:
    print(f"ID: {rest['_id']}, Name: {rest['name']}")
