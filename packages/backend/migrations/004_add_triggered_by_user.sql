-- Add triggered_by_user_id column to analysis_runs for tracking who initiated the analysis
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS triggered_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN analysis_runs.triggered_by_user_id IS 'User who triggered the analysis (null for scheduled/api triggers without user context)';

-- Create index for faster lookups by user
CREATE INDEX IF NOT EXISTS idx_analysis_runs_triggered_by_user ON analysis_runs(triggered_by_user_id);
