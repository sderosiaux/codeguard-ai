-- Add commit SHA and trigger source columns to analysis_runs
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS commit_sha TEXT;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS triggered_by TEXT DEFAULT 'initial';

COMMENT ON COLUMN analysis_runs.commit_sha IS 'Git commit SHA that was analyzed';
COMMENT ON COLUMN analysis_runs.triggered_by IS 'How the analysis was triggered: initial, recheck, api, scheduled';

-- Create index for faster history queries
CREATE INDEX IF NOT EXISTS idx_analysis_runs_repo_created ON analysis_runs(repository_id, created_at DESC);
