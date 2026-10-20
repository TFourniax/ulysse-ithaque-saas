-- Preserve the UL-016 VPS mode and historical runs, without changing migration 0012.
ALTER TABLE workflow_requests DROP CONSTRAINT workflow_requests_mode_check;
ALTER TABLE workflow_requests ADD CONSTRAINT workflow_requests_mode_check
  CHECK (mode IN ('rules','simulated','hermes-live','hermes-stub'));
