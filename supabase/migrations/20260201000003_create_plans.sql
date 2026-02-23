-- Migration: Create plans table for subscription limits and MRR

CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  docs_limit_month INTEGER NOT NULL DEFAULT 0,
  mrr_cents INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY plans_read_only ON plans
  FOR SELECT
  USING (true);

COMMENT ON TABLE plans IS 'Subscription plans with monthly document limits and MRR';
COMMENT ON COLUMN plans.docs_limit_month IS 'Monthly document limit per tenant';
COMMENT ON COLUMN plans.mrr_cents IS 'Monthly recurring revenue in cents';

INSERT INTO plans (name, docs_limit_month, mrr_cents)
VALUES
  ('starter', 100, 19900),
  ('pro', 500, 49900),
  ('business', 2000, 120000),
  ('enterprise', 10000, 300000)
ON CONFLICT (name) DO NOTHING;
