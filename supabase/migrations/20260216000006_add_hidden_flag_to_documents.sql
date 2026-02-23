-- Migration: allow hiding cancelled documents from UI lists
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;

-- Only cancelled documents can be hidden
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'documents_hidden_only_when_cancelled'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_hidden_only_when_cancelled
      CHECK (is_hidden = FALSE OR status = 'CANCELLED');
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_documents_tenant_hidden
  ON documents(tenant_id, is_hidden);

COMMENT ON COLUMN documents.is_hidden IS 'Marks cancelled documents as hidden in UI listings without deleting them';
