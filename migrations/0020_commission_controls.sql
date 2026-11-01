-- One mutable control state per attributed order with immutable accounting entries.
CREATE TABLE commission_controls (
  orderId TEXT PRIMARY KEY REFERENCES agent_order_attribution(orderId),
  state TEXT NOT NULL CHECK(state IN ('active','hold','refunded')),
  revision INTEGER NOT NULL DEFAULT 0,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE commission_control_audit (
  operationId TEXT PRIMARY KEY,
  executionId TEXT NOT NULL UNIQUE,
  orderId TEXT NOT NULL REFERENCES agent_order_attribution(orderId),
  action TEXT NOT NULL CHECK(action IN ('hold','release','refund')),
  stateBefore TEXT NOT NULL,
  stateAfter TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL CHECK(actor='owner'),
  createdAt INTEGER NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0 CHECK(applied IN (0,1))
);
CREATE INDEX commission_control_audit_order ON commission_control_audit(orderId,createdAt);
