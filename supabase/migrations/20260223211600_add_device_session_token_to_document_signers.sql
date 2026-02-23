ALTER TABLE public.document_signers
ADD COLUMN IF NOT EXISTS device_session_token UUID;

CREATE INDEX IF NOT EXISTS idx_document_signers_device_session_token
ON public.document_signers(device_session_token);
