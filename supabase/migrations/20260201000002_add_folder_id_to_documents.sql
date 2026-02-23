-- Migration: Add folder_id to documents table
-- Allows documents to be organized into folders (visual only)

-- Add folder_id column (nullable - documents can exist without folder)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders(id) ON DELETE SET NULL;

-- Index for efficient folder filtering
CREATE INDEX IF NOT EXISTS idx_documents_folder_id ON documents(folder_id);

-- Composite index for tenant + folder queries
CREATE INDEX IF NOT EXISTS idx_documents_tenant_folder ON documents(tenant_id, folder_id);

-- Documentation
COMMENT ON COLUMN documents.folder_id IS 'Optional folder for visual organization. NULL means document is at root level';
