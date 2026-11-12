CREATE TABLE agent_push_subscriptions (endpoint TEXT PRIMARY KEY, agentId TEXT NOT NULL REFERENCES agents(id), subscription TEXT NOT NULL, createdAt INTEGER NOT NULL);
CREATE INDEX agent_push_subscriptions_agent ON agent_push_subscriptions(agentId);
CREATE TABLE agent_push_outbox (orderId TEXT NOT NULL, agentId TEXT NOT NULL, endpoint TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, nextAttemptAt INTEGER NOT NULL, sentAt INTEGER, createdAt INTEGER NOT NULL, PRIMARY KEY(orderId,agentId,endpoint));
CREATE INDEX agent_push_outbox_pending ON agent_push_outbox(sentAt,nextAttemptAt);
