CREATE TABLE telegram_order_chats (
  chatId TEXT PRIMARY KEY,
  startedAt INTEGER NOT NULL,
  leaseUntil INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE telegram_order_messages (
  chatId TEXT NOT NULL,
  orderId TEXT NOT NULL REFERENCES orders(id),
  ref TEXT NOT NULL UNIQUE,
  messageId INTEGER,
  snapshot TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  contactedAt INTEGER,
  retryAt INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chatId, orderId)
);

CREATE INDEX telegram_order_messages_order ON telegram_order_messages(orderId);
CREATE INDEX telegram_orders_updated ON orders(updatedAt);

CREATE VIEW telegram_order_status AS
SELECT o.id, o.code, o.title, o.amountCents, o.method, o.createdAt, o.updatedAt, o.status,
  CASE
    WHEN o.status = 'processing' AND s.state = 'purchase_unknown' THEN 'purchase_unknown'
    WHEN o.status = 'processing' AND (s.state = 'mail_unknown' OR e.status = 'unknown') THEN 'mail_unknown'
    WHEN o.status = 'processing' AND o.stockIssue = 1 THEN 'stock_issue'
    WHEN o.status = 'processing' AND s.state = 'awaiting' THEN 'awaiting_supplier'
    ELSE o.status
  END AS stage
FROM orders o
LEFT JOIN supplier_fulfillment s ON s.orderId = o.id
LEFT JOIN delivery_emails e ON e.orderId = o.id;
