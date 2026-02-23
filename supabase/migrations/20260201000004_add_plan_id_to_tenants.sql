-- Migration: Add plan_id to tenants

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES plans(id);

CREATE INDEX IF NOT EXISTS idx_tenants_plan_id ON tenants(plan_id);

COMMENT ON COLUMN tenants.plan_id IS 'Subscription plan reference';
