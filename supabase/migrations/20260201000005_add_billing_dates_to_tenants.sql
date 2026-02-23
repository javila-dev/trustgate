-- Migration: Add billing period dates and customer_since to tenants

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS billing_period_start DATE,
  ADD COLUMN IF NOT EXISTS billing_period_end DATE,
  ADD COLUMN IF NOT EXISTS customer_since DATE;

COMMENT ON COLUMN tenants.billing_period_start IS 'Start date for current billing period';
COMMENT ON COLUMN tenants.billing_period_end IS 'End date for current billing period';
COMMENT ON COLUMN tenants.customer_since IS 'Date when tenant became a customer';

UPDATE tenants
SET
  billing_period_start = COALESCE(billing_period_start, CURRENT_DATE),
  billing_period_end = COALESCE(billing_period_end, (CURRENT_DATE + INTERVAL '1 month')::date),
  customer_since = COALESCE(customer_since, CURRENT_DATE)
WHERE billing_period_start IS NULL
   OR billing_period_end IS NULL
   OR customer_since IS NULL;
