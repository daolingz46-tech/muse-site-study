CREATE TABLE traffic_visits (
 id TEXT PRIMARY KEY, channel TEXT NOT NULL, platform TEXT NOT NULL,
 referrerHost TEXT NOT NULL, medium TEXT NOT NULL, campaign TEXT NOT NULL, content TEXT NOT NULL,
 landingPage TEXT NOT NULL, evidence TEXT NOT NULL, device TEXT NOT NULL, wechat INTEGER NOT NULL,
 agentId TEXT REFERENCES agents(id), createdAt INTEGER NOT NULL, lastSeenAt INTEGER NOT NULL
);
CREATE INDEX traffic_visits_time ON traffic_visits(createdAt);
CREATE TABLE traffic_views (visitId TEXT NOT NULL REFERENCES traffic_visits(id), product TEXT NOT NULL, PRIMARY KEY(visitId,product));
CREATE TABLE traffic_orders (orderId TEXT PRIMARY KEY REFERENCES orders(id), visitId TEXT NOT NULL REFERENCES traffic_visits(id));
CREATE INDEX traffic_orders_visit ON traffic_orders(visitId);
