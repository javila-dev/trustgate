-- Migration: Add continuity token support for IN_REVIEW verification flow
-- This allows users who go through manual review to return and complete signing

-- Add new columns to verification_attempts
ALTER TABLE verification_attempts ADD COLUMN IF NOT EXISTS continuity_token UUID;
ALTER TABLE verification_attempts ADD COLUMN IF NOT EXISTS continuity_token_expires_at TIMESTAMPTZ;
ALTER TABLE verification_attempts ADD COLUMN IF NOT EXISTS continuity_token_used_at TIMESTAMPTZ;
ALTER TABLE verification_attempts ADD COLUMN IF NOT EXISTS was_in_review BOOLEAN DEFAULT FALSE;

-- Create index for token lookup
CREATE INDEX IF NOT EXISTS idx_verification_attempts_continuity_token
ON verification_attempts(continuity_token)
WHERE continuity_token IS NOT NULL;

-- Add REVIEW_APPROVED as valid status for document_signers
-- (This is a comment for documentation - the status column likely uses text/varchar)
COMMENT ON COLUMN verification_attempts.continuity_token IS 'UUID token for continuing verification after manual review';
COMMENT ON COLUMN verification_attempts.continuity_token_expires_at IS 'Expiration timestamp for continuity token (48h from creation)';
COMMENT ON COLUMN verification_attempts.continuity_token_used_at IS 'Timestamp when token was redeemed (null = not used yet)';
COMMENT ON COLUMN verification_attempts.was_in_review IS 'Flag indicating this attempt went through manual review';
