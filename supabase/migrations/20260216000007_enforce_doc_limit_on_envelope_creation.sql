-- Enforce monthly document quota when a document gets its first Documenso envelope.
-- This keeps "effective documents" aligned with docs that have documenso_envelope_id.

CREATE OR REPLACE FUNCTION public.enforce_document_quota_on_envelope_creation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_docs_limit INTEGER;
  v_docs_used INTEGER;
  v_month_start TIMESTAMPTZ;
BEGIN
  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.docs_limit_month, 0)
    INTO v_docs_limit
  FROM tenants t
  LEFT JOIN plans p ON p.id = t.plan_id
  WHERE t.id = NEW.tenant_id;

  -- 0 means unlimited / no enforced cap
  IF v_docs_limit <= 0 THEN
    RETURN NEW;
  END IF;

  -- Keep current behavior aligned with account metrics: UTC month window.
  v_month_start := date_trunc('month', (now() AT TIME ZONE 'UTC')) AT TIME ZONE 'UTC';

  SELECT COUNT(*)
    INTO v_docs_used
  FROM documents d
  WHERE d.tenant_id = NEW.tenant_id
    AND d.created_at >= v_month_start
    AND d.documenso_envelope_id IS NOT NULL
    AND d.id <> NEW.id;

  IF v_docs_used >= v_docs_limit THEN
    RAISE EXCEPTION 'Límite mensual de documentos alcanzado (%).', v_docs_limit
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_doc_quota_on_envelope_insert ON documents;
CREATE TRIGGER trg_enforce_doc_quota_on_envelope_insert
BEFORE INSERT ON documents
FOR EACH ROW
WHEN (NEW.documenso_envelope_id IS NOT NULL)
EXECUTE FUNCTION public.enforce_document_quota_on_envelope_creation();

DROP TRIGGER IF EXISTS trg_enforce_doc_quota_on_envelope_update ON documents;
CREATE TRIGGER trg_enforce_doc_quota_on_envelope_update
BEFORE UPDATE OF documenso_envelope_id ON documents
FOR EACH ROW
WHEN (OLD.documenso_envelope_id IS NULL AND NEW.documenso_envelope_id IS NOT NULL)
EXECUTE FUNCTION public.enforce_document_quota_on_envelope_creation();
