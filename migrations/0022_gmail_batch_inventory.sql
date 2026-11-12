ALTER TABLE supplier_fulfillment ADD COLUMN batchCostCents INTEGER;
ALTER TABLE inventory_cards ADD COLUMN costCents INTEGER;
CREATE UNIQUE INDEX one_gmail_backup_batch_in_progress ON supplier_fulfillment(instruction) WHERE instruction='source:G88230690' AND state IN ('purchasing','awaiting','purchase_unknown');
