-- Additive: the previous release never reads or writes this table.
-- Evidence is written in the transaction that records the event, which runs scoped to its space,
-- so the application may add rows for the space it is working in. Postgres also asks for a read
-- policy when the insert says ON CONFLICT DO NOTHING. Nothing can update or delete evidence.
CREATE POLICY action_evidence_tenant_insert ON "action_evidence"
  FOR INSERT
  WITH CHECK ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY action_evidence_tenant_select ON "action_evidence"
  FOR SELECT
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
