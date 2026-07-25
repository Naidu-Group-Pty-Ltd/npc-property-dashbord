-- AML transaction records and their hash-chained events are compliance evidence.
-- Retain both when the legacy delete operation is requested.
ALTER TABLE aml.transactions
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS archived_by uuid NULL;

REVOKE DELETE ON aml.transactions FROM authenticated;

DROP POLICY IF EXISTS "aml_tx_write" ON aml.transactions;
CREATE POLICY "aml_tx_insert" ON aml.transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_aml_write_role(auth.uid()));
CREATE POLICY "aml_tx_update" ON aml.transactions
  FOR UPDATE TO authenticated
  USING (public.has_aml_write_role(auth.uid()))
  WITH CHECK (public.has_aml_write_role(auth.uid()));

ALTER TABLE aml.transaction_events
  DROP CONSTRAINT IF EXISTS transaction_events_transaction_id_fkey;
ALTER TABLE aml.transaction_events
  ADD CONSTRAINT transaction_events_transaction_id_fkey
  FOREIGN KEY (transaction_id) REFERENCES aml.transactions(id) ON DELETE RESTRICT;
