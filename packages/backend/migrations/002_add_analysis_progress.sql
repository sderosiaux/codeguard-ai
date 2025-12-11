-- Add analysis progress tracking columns to repositories
-- These columns enable detailed progress feedback during analysis

-- Analysis stage for granular progress tracking
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS analysis_stage TEXT;

-- Agent progress as JSON array tracking individual agent status
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS agent_progress JSONB;

-- Add comment for documentation
COMMENT ON COLUMN repositories.analysis_stage IS 'Detailed analysis stage: queued, cloning, detecting, analyzing, processing, completed, error';
COMMENT ON COLUMN repositories.agent_progress IS 'JSON array of agent progress objects: [{id, name, status, startedAt, completedAt}]';
