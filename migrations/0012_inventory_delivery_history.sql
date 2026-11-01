CREATE TABLE inventory_cards (
 id TEXT PRIMARY KEY, product TEXT NOT NULL, card TEXT NOT NULL, cardHash TEXT NOT NULL UNIQUE,
 tradeNo TEXT NOT NULL, instruction TEXT, orderId TEXT UNIQUE REFERENCES orders(id), createdAt INTEGER NOT NULL
);
ALTER TABLE supplier_fulfillment ADD COLUMN inventoryId TEXT REFERENCES inventory_cards(id);
CREATE TABLE delivery_history (
 id TEXT PRIMARY KEY, orderId TEXT NOT NULL REFERENCES orders(id), text TEXT NOT NULL, state TEXT NOT NULL, createdAt INTEGER NOT NULL
);
