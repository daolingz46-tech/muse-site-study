-- Foundation only. No production activation or automatic payout.
CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, referralCode TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK(status IN ('active','disabled')), createdAt INTEGER NOT NULL);
CREATE TABLE agent_commission_rules (productKey TEXT PRIMARY KEY, amountCents INTEGER NOT NULL CHECK(amountCents>=0), updatedAt INTEGER NOT NULL);
CREATE TABLE agent_order_attribution (orderId TEXT PRIMARY KEY REFERENCES orders(id), agentId TEXT NOT NULL REFERENCES agents(id), productKey TEXT NOT NULL, commissionCents INTEGER NOT NULL CHECK(commissionCents>=0), ruleVersion INTEGER NOT NULL, createdAt INTEGER NOT NULL);
CREATE TABLE agent_ledger (id TEXT PRIMARY KEY, agentId TEXT NOT NULL REFERENCES agents(id), orderId TEXT REFERENCES orders(id), eventKey TEXT NOT NULL UNIQUE, amountCents INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('commission','adjustment','withdrawal','withdrawal_reversal')), availableAt INTEGER NOT NULL, createdAt INTEGER NOT NULL);
CREATE TABLE agent_withdrawals (id TEXT PRIMARY KEY, agentId TEXT NOT NULL REFERENCES agents(id), amountCents INTEGER NOT NULL CHECK(amountCents>0), status TEXT NOT NULL CHECK(status IN ('pending','approved','paying','paid','rejected','unknown')), requestedAt INTEGER NOT NULL, approvedAt INTEGER, dueAt INTEGER, paidAt INTEGER, updatedAt INTEGER NOT NULL);
CREATE INDEX agent_ledger_agent_time ON agent_ledger(agentId, availableAt);
CREATE TABLE agent_credentials (agentId TEXT PRIMARY KEY REFERENCES agents(id), salt TEXT NOT NULL, passwordHash TEXT NOT NULL, iterations INTEGER NOT NULL, createdAt INTEGER NOT NULL);
CREATE TABLE agent_sessions (hash TEXT PRIMARY KEY, agentId TEXT NOT NULL REFERENCES agents(id), expiresAt INTEGER NOT NULL);
CREATE INDEX agent_sessions_expiry ON agent_sessions(expiresAt);
