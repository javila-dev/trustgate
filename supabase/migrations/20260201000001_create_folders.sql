-- Migration: Create folders table for visual document organization
-- Folders are tenant-scoped and support single-level hierarchy only

-- Create folders table
CREATE TABLE IF NOT EXISTS folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(7) DEFAULT '#6366f1',
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),

  -- Unique folder name per tenant
  UNIQUE(tenant_id, name)
);

-- Indices for efficient queries
CREATE INDEX IF NOT EXISTS idx_folders_tenant_id ON folders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_folders_position ON folders(tenant_id, position);

-- Enable Row Level Security
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access folders from their tenant
CREATE POLICY folders_tenant_isolation ON folders
  FOR ALL
  USING (tenant_id IN (
    SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
  ));

-- Comments for documentation
COMMENT ON TABLE folders IS 'Visual folders for organizing documents within a tenant';
COMMENT ON COLUMN folders.name IS 'Display name of the folder (unique per tenant)';
COMMENT ON COLUMN folders.color IS 'Hex color code for visual identification';
COMMENT ON COLUMN folders.position IS 'Sort order for manual arrangement';
