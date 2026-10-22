-- Separate generation, provider recovery and factual review share one bounded run.
-- Existing deal limits and tenant financial reservations are unchanged.
ALTER TABLE agent_runs DROP CONSTRAINT agent_runs_model_calls_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_model_calls_check
  CHECK (model_calls BETWEEN 0 AND CASE WHEN workflow_kind = 'deal' THEN 8 ELSE 12 END);
