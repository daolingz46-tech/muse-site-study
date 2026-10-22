CREATE TABLE visits (
 id TEXT PRIMARY KEY,
 page TEXT NOT NULL,
 source TEXT NOT NULL,
 device TEXT NOT NULL,
 createdAt INTEGER NOT NULL
);
CREATE INDEX visits_created ON visits(createdAt DESC);
