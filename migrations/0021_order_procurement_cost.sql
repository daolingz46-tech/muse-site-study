CREATE TABLE order_procurement_cost (
 orderId TEXT PRIMARY KEY REFERENCES orders(id), goodsNo TEXT NOT NULL, supplierName TEXT NOT NULL DEFAULT '', costCents INTEGER, source TEXT NOT NULL, updatedAt INTEGER NOT NULL
);
