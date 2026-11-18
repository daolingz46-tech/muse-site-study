CREATE TABLE traffic_source_answers (
  visitId TEXT PRIMARY KEY REFERENCES traffic_visits(id),
  source TEXT NOT NULL,
  answeredAt INTEGER NOT NULL
);
CREATE INDEX traffic_source_answers_time ON traffic_source_answers(answeredAt);
