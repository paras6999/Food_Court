from backend.db import tables_col, restaurants_col

# Get all restaurants
rests = list(restaurants_col.find({'approved': True}))
print(f'Found {len(rests)} restaurants')

# Clear existing tables and add demo tables
tables_col.delete_many({})
table_count = 0

for rest in rests:
    rest_id = rest['_id']
    # Add 6-10 tables per restaurant
    num_tables = 8 if 'Pizza' in rest['name'] else 6 if 'Burger' in rest['name'] else 5
    for t in range(1, num_tables + 1):
        tables_col.insert_one({
            'restaurant_id': rest_id,
            'table_number': t,
            'status': 'available'
        })
        table_count += 1

print(f'Created {table_count} demo tables')

# Verify
for rest in rests:
    tables = list(tables_col.find({'restaurant_id': rest['_id']}))
    print(f'{rest["name"]}: {len(tables)} tables')