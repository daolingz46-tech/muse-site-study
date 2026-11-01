ALTER TABLE agent_withdrawals ADD COLUMN paymentReference TEXT;
CREATE UNIQUE INDEX agent_withdrawal_reference_unique ON agent_withdrawals(paymentReference) WHERE paymentReference IS NOT NULL;
