CREATE TABLE telegram_delivery_drafts (
  chatId TEXT PRIMARY KEY,
  ref TEXT NOT NULL,
  orderId TEXT NOT NULL REFERENCES orders(id),
  promptId INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,
  payload TEXT
);
