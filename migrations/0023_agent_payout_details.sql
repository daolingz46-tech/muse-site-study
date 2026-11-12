CREATE TABLE agent_payout_codes (id TEXT PRIMARY KEY, agentId TEXT NOT NULL REFERENCES agents(id), method TEXT NOT NULL CHECK(method IN ('alipay','wechat')), mime TEXT NOT NULL, image TEXT NOT NULL, createdAt INTEGER NOT NULL);
ALTER TABLE agent_withdrawals ADD COLUMN payoutCodeId TEXT REFERENCES agent_payout_codes(id);
CREATE TABLE withdrawal_notice_outbox (withdrawalId TEXT PRIMARY KEY REFERENCES agent_withdrawals(id), attempts INTEGER NOT NULL DEFAULT 0, nextAttemptAt INTEGER NOT NULL, sentAt INTEGER);
