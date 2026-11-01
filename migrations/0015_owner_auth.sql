-- Owner elevation is bound to an existing administrator session.
CREATE TABLE owner_sessions (
  hash TEXT PRIMARY KEY,
  adminHash TEXT NOT NULL,
  credentialVersion TEXT NOT NULL,
  expiresAt INTEGER NOT NULL
);
CREATE INDEX owner_sessions_expiry ON owner_sessions(expiresAt);
CREATE INDEX owner_sessions_admin ON owner_sessions(adminHash);
