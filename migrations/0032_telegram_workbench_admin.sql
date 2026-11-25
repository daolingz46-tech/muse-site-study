ALTER TABLE telegram_delivery_partners ADD COLUMN role TEXT NOT NULL DEFAULT 'delivery'
  CHECK (role IN ('delivery','admin'));

ALTER TABLE sessions ADD COLUMN telegramChatId TEXT;
CREATE INDEX sessions_telegram_chat ON sessions(telegramChatId);

CREATE TABLE telegram_admin_tickets (
  hash TEXT PRIMARY KEY,
  chatId TEXT NOT NULL REFERENCES telegram_delivery_partners(chatId) ON DELETE CASCADE,
  destination TEXT NOT NULL,
  expiresAt INTEGER NOT NULL
);
CREATE INDEX telegram_admin_tickets_expiry ON telegram_admin_tickets(expiresAt);
