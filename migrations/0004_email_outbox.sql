CREATE TABLE email_outbox (
 id TEXT PRIMARY KEY,
 orderId TEXT NOT NULL,
 eventType TEXT NOT NULL CHECK(eventType IN ('created','reported')),
 attempts INTEGER NOT NULL DEFAULT 0,
 nextAttemptAt INTEGER NOT NULL,
 sentAt INTEGER,
 lastError TEXT,
 createdAt INTEGER NOT NULL,
 UNIQUE(orderId,eventType)
);
CREATE INDEX email_outbox_pending ON email_outbox(sentAt,nextAttemptAt);
