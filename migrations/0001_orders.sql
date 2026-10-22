CREATE TABLE orders (
 id TEXT PRIMARY KEY, requestHash TEXT NOT NULL UNIQUE, inputHash TEXT NOT NULL,
 tokenHash TEXT NOT NULL, code TEXT NOT NULL CHECK(length(code)=4), activeCode INTEGER NOT NULL DEFAULT 1,
 product TEXT NOT NULL, title TEXT NOT NULL, amountCents INTEGER NOT NULL, target TEXT NOT NULL,
 method TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', createdAt INTEGER NOT NULL,
 expiresAt INTEGER NOT NULL, reportedAt INTEGER, paidAt INTEGER, completedAt INTEGER,
 reference TEXT, delivery TEXT, updatedAt INTEGER NOT NULL
);
CREATE UNIQUE INDEX active_order_code ON orders(code) WHERE activeCode=1;
CREATE UNIQUE INDEX payment_reference ON orders(method,reference) WHERE reference IS NOT NULL;
CREATE INDEX orders_created ON orders(createdAt DESC);
CREATE INDEX orders_status ON orders(status,createdAt DESC);
CREATE TABLE sessions (hash TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expiresAt INTEGER NOT NULL);
CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, orderId TEXT NOT NULL, action TEXT NOT NULL, createdAt INTEGER NOT NULL);
