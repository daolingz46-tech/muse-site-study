ALTER TABLE orders ADD COLUMN supplierPlan TEXT;
CREATE TABLE supplier_fulfillment (
  orderId TEXT PRIMARY KEY REFERENCES orders(id),
  state TEXT NOT NULL,
  tradeNo TEXT,
  card TEXT,
  instruction TEXT,
  updatedAt INTEGER NOT NULL
);
