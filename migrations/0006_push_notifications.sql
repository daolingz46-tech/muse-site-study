CREATE TABLE push_subscriptions (
 endpoint TEXT PRIMARY KEY,
 subscription TEXT NOT NULL,
 createdAt INTEGER NOT NULL
);
CREATE TABLE push_outbox (
 orderId TEXT NOT NULL,
 eventType TEXT NOT NULL CHECK(eventType IN ('created','reported')),
 endpoint TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 nextAttemptAt INTEGER NOT NULL,
 sentAt INTEGER,
 createdAt INTEGER NOT NULL,
 PRIMARY KEY(orderId,eventType,endpoint)
);
CREATE INDEX push_outbox_pending ON push_outbox(sentAt,nextAttemptAt);
