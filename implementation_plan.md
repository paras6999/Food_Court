# Master Implementation Plan - Ultimate Food Court Premium Feature Suite

This document describes the complete technical layout for expanding the Food Court platform into an elite, full-featured digital dining system.

---

## User Review Required

> [!IMPORTANT]
> **Gemini API Key:** The AI Business Analyst requires a Google Gemini API Key. To run this feature, you should add `GEMINI_API_KEY=your_actual_api_key_here` to your `.env` file. We will build a safe, direct integration using `requests` that handles missing or incorrect keys with helpful user fallback suggestions.

---

## 1. Unified Design System, Theme Toggle, & Glassmorphic Polish
We will overhaul the global styling with rich glassmorphism, glowing borders, smooth slide/fade micro-animations, and a responsive Theme Switcher.

### [MODIFY] [style.css](file:///c:/Users/paras/OneDrive/Desktop/python_project/Food_court/static/css/style.css)
- **CSS Variables Override (`body.light-theme`):**
  Redefine theme tokens for a flawless light-theme experience:
  ```css
  body.light-theme {
      --secondary: #f4f6f8;
      --surface: #ffffff;
      --surface2: #f1f3f5;
      --text-primary: #1e293b;
      --text-muted: #64748b;
      --border: rgba(0, 0, 0, 0.08);
      --card-bg: rgba(255, 255, 255, 0.95);
      --shadow: 0 8px 32px rgba(0, 0, 0, 0.06);
      --shadow-card: 0 4px 16px rgba(0, 0, 0, 0.04);
  }
  ```
- **Animations:** Define standard entry keyframes: `@keyframes slideInUp`, `@keyframes pulseGlow`, `@keyframes floatIn`.
- **Skeleton Loaders:** Polish skeleton style to be smoother and have an elegant shimmering effect.
- **Flying Cart Animation CSS:** Styling classes for a temporary thumbnail to float dynamically toward the cart icon.

### [MODIFY] [main.js](file:///c:/Users/paras/OneDrive/Desktop/python_project/Food_court/static/js/main.js)
- Check `localStorage.getItem('fc-theme')` on load and apply the `light-theme` class to `document.body` if required.
- Add `toggleTheme()` to toggle class lists and save state.
- Include general utility to initialize **Theme Toggle Switch Elements** (represented as a Sun/Moon icon in navbars).

### [MODIFY] Navbars across HTML Templates
- Add the theme toggle button next to the login/logout buttons in:
  - `index.html`
  - `customer_table.html`
  - `menu.html`
  - `orders.html`
  - `restaurant_dashboard.html`

---

## 2. In-App Web-Camera QR Scanner (Homepage)
Convert the static mock scanning modal on the homepage into a fully functional camera scanner.

### [MODIFY] [index.html](file:///c:/Users/paras/OneDrive/Desktop/python_project/Food_court/templates/index.html)
- Include the lightweight `html5-qrcode` CDN:
  `<script src="https://unpkg.com/html5-qrcode"></script>`
- Insert a `<div id="qr-reader" style="width: 100%; border-radius: 12px; margin-top: 1rem;"></div>` container in the modal.

### [MODIFY] [customer.js](file:///c:/Users/paras/OneDrive/Desktop/python_project/Food_court/static/js/customer.js)
- Wire up `openQrScanner()` to initialize the web camera stream within the modal.
- On successful URL detection, extract parameters (`restaurant` and `table`), play an audible feedback tone, stop camera tracks, and redirect to: `/customer_table.html?restaurant=<id>&table=<num>`.

---

## 3. Dietary Filters, Spicy Levels, & Add-Ons Bottom-Sheet (Customer Menu)
Present a highly tactile sliding bottom-sheet/modal when clicking a menu item.

### [MODIFY] customer.js / table_order.js & HTML templates
- Add dynamic menu item badges: **Veg (🟢)** and **Non-Veg (🔴)**.
- Implement filter toggles: **[Veg Only]** and **[Bestsellers]**.
- When clicking on a menu item:
  - Slide up a customized details modal containing item image, description, and interactive options:
    - **Spiciness Level:** Interactive slider or badges (Mild 🌶️, Medium 🌶️🌶️, Spicy 🌶️🌶️🌶️).
    - **Add-ons Checklist:** Extra Cheese (+₹30), Double Patty (+₹50), etc.
    - **Quantity Selector:** Smooth counter controllers.
  - When clicking "Add to Cart", calculate custom prices and push to the cart drawer with dynamic sliding cart animations.

---

## 4. Unified Multi-Vendor Cart (Customer App)
Allow users to browse multiple restaurants, add items to a single global cart drawer, and check out with ease.

### [MODIFY] [customer.js](file:///c:/Users/paras/OneDrive/Desktop/python_project/Food_court/static/js/customer.js)
- Redesign the Cart Storage structure in `localStorage` to group items by `restaurant_id`:
  ```javascript
  // Multi-vendor cart structure
  cart = {
      "rest_id_1": {
          "restaurant_name": "Pizza Place",
          "items": [ { "item_id": "...", "quantity": 1, "price": 250, "name": "..." } ]
      },
      "rest_id_2": {
          "restaurant_name": "Burger Shack",
          "items": [ { "item_id": "...", "quantity": 2, "price": 120, "name": "..." } ]
      }
  }
  ```
- **Unified Checkout Handler:**
  When checking out:
  - If paying Cash on Delivery, loop and send parallel order requests to `/api/order` for each restaurant in the cart!
  - If paying online via Razorpay, generate a unified checkout amount, invoke Razorpay once, and on a successful callback, send concurrent payment-verified order placement requests backend-side!
  - Clear the global cart and show a consolidated success screen tracking all placed orders!

---

## 5. Dine-In Guest Checkout & Login Discount Incentives
Reduce ordering friction at dining tables by removing strict login blocks, while offering a discount (e.g. 10% Off) if they log in.

### [MODIFY] [customer.py](file:///c:/Users/paras/OneDrive/Desktop/python_project/Food_court/backend/routes/customer.py)
- Make `place_order` and `service_request` token-optional by utilizing `verify_jwt_in_request(optional=True)`.
- If a guest checkout request is received:
  - If `table_number` is provided, allow the order to be created with `user_id = "guest"` and save a name (e.g. "Guest").
  - If `table_number` is missing (home delivery), reject with a `401 Unauthorized` exception.
- In `place_order` and `verify_payment`, fetch the restaurant's active `discount_pct`:
  - If the user is **logged in**, calculate the final price with the restaurant's `discount_pct` applied.
  - If the user is a **guest**, calculate the final price at standard menu rates.

### [MODIFY] [restaurant.py](file:///c:/Users/paras/OneDrive/Desktop/python_project/Food_court/backend/routes/restaurant.py)
- Support an optional percentage discount `discount_pct` field (e.g., `10` representing 10% off) when restaurants update their offers:
  `restaurants_col.update_one({"_id": rest_id}, {"$set": {"offer": offer_text, "discount_pct": discount_pct}})`

### [MODIFY] [customer_table.html](file:///c:/Users/paras/OneDrive/Desktop/python_project/Food_court/templates/customer_table.html)
- Bypass the login blocker during dine-in menu browsing.
- Display an attractive, pulsing login promotional banner:
  `"✨ Sign in/Log in now to unlock an exclusive 10% discount on your table order!"`

### [MODIFY] [table_order.js](file:///c:/Users/paras/OneDrive/Desktop/python_project/Food_court/static/js/table_order.js)
- Allow calling checkout even if the user is not authenticated.
- If they are a guest, save placed order IDs in `localStorage` under `fc_guest_orders` so they can still see and track their live cooking progress timeline on their mobile screen!

---

## 6. Live Order Tracking Timeline
Provide a real-time status tracker for customer orders.

### [MODIFY] table_order.js / customer.js & HTML templates
- Create an interactive visual progress track with steps:
  `Placed (🟠) ➔ Accepted (🔵) ➔ Cooking (🔥) ➔ Ready (🟢) ➔ Served/Delivered (✔️)`
- Style it with high-end glow animations.
- Set up an automatic 8-second polling timer that checks current status and updates the timeline instantly with nice transition fades.

---

## 7. Audible KDS, Kanban Board, & Stock Toggles (Restaurant Panel)
Improve kitchen management speed with real-time cues.

### [MODIFY] [restaurant_dashboard.html](file:///c:/Users/paras/OneDrive/Desktop/python_project/Food_court/templates/restaurant_dashboard.html)
- Add a hidden HTML `<audio id="notification-sound" src="/static/uploads/bell.mp3" preload="auto"></audio>` asset (we will seed a small high-quality alert sound file).
- Build a three-column Kanban display option for orders: **[Pending]**, **[Preparing/Ready]**, and **[Delivered/Completed]**.
- Include quick toggle switches `[Available / Out of Stock]` inline with each menu item in the dashboard menu list.

### [MODIFY] [restaurant.js](file:///c:/Users/paras/OneDrive/Desktop/python_project/Food_court/static/js/restaurant.js)
- **KDS Alarms:** Play the chime whenever a new order enters the pending list.
- **Stock Toggles:** Add `toggleItemAvailability(itemId, currentStatus)` to make immediate API calls to `/api/menu/update/<item_id>` to flip stock status. Update menu listings on screen instantly.

---

## 8. Digital Thermal Receipts & WhatsApp Billing
Generate professional tax invoice records.

### [NEW] [bill.html](file:///c:/Users/paras/OneDrive/Desktop/python_project/Food_court/templates/bill.html)
- Create a printable thermal-invoice styling layout (dotted lines, centered receipt details, item tables, discount summaries, store location).
- Floating "Print" button triggers `window.print()` (with CSS media rules to strip webpage panels during printing).

### [MODIFY] [app.py](file:///c:/Users/paras/OneDrive/Desktop/python_project/Food_court/app.py)
- Register public route `/bill/<order_id>` to serve `bill.html`.

### [MODIFY] [restaurant.js](file:///c:/Users/paras/OneDrive/Desktop/python_project/Food_court/static/js/restaurant.js)
- **Print Bill:** Opens `/bill/<order_id>` in a blank tab.
- **WhatsApp Bill:** 
  - Construct a perfectly aligned textual receipt summary with bullet characters and bold font tags.
  - Append the printable invoice URL.
  - Redirect to `https://wa.me/?text=<message>` to allow instant dispatching on WhatsApp.

---

## 9. AI Dashboard Analyst Chatbot for Restaurant Owners
Add an intelligent data advisor tool inside the restaurant dashboard.

### [MODIFY] [restaurant.py](file:///c:/Users/paras/OneDrive/Desktop/python_project/Food_court/backend/routes/restaurant.py)
- Create `/api/restaurant/ai-analyst` endpoint:
  - Aggregate restaurant sales metrics: gross revenue, total counts, order statuses, dine-in vs delivery split, daily performance rates, reviews sentiment.
  - Invoke Google Gemini API with this operational history and user's query. Return the markdown analysis response.

### [MODIFY] [restaurant_dashboard.html](file:///c:/Users/paras/OneDrive/Desktop/python_project/Food_court/templates/restaurant_dashboard.html)
- Add a floating Chat panel in the corner of the workspace.
- Include quick-prompt suggestion cards:
  - `"📈 Analyze weekly sales patterns"`
  - `"⭐ Summarize user reviews"`
  - `"💡 How do I increase revenue?"`

### [MODIFY] [restaurant.js](file:///c:/Users/paras/OneDrive/Desktop/python_project/Food_court/static/js/restaurant.js)
- Add AJAX client-side chat triggers, visual typing indicators (`...`), chat bubble creation, and auto-scrolling functions.

---

## Verification Plan

### Automated/Local Sandbox Testing
1. **Theme Switch:** Toggle light/dark options and verify flawless contrast on all views.
2. **Web Camera Scanner:** Open live scanner, test with simulated QR targets, and verify parameter extraction and routing.
3. **Unified Checkout:** Place orders containing items from multiple distinct restaurants and verify backend splits.
4. **Guest Checkout:** Place table orders as guest, verify localStorage state, and track active statuses.
5. **AI Analyst Chat:** Ask business analysis questions and verify contextual answers.
6. **Thermal Receipt & WhatsApp:** Confirm proper alignment on thermal invoices and successful text assembly for WhatsApp.
