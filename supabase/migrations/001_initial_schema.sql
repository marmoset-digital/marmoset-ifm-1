-- ===========================================
-- MARMOSET HUB — Database Schema
-- Supabase PostgreSQL Migration
-- ===========================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -------------------------------------------
-- ORDERS — Single source of truth
-- -------------------------------------------
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gravity_form_entry_id TEXT NOT NULL,
  unique_code TEXT NOT NULL UNIQUE,        -- e.g. "SW100"
  raw_payload JSONB NOT NULL,              -- Full GF webhook payload
  parsed_data JSONB NOT NULL,              -- Structured ParsedOrder
  status TEXT NOT NULL DEFAULT 'received',
  total_amount DECIMAL(10, 2) NOT NULL,
  payment_method TEXT NOT NULL,            -- 'Credit Card' | 'Bank Transfer' | 'Cheque'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------
-- PAYMENTS — eWAY transactions & bank transfers
-- -------------------------------------------
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  eway_txn_id TEXT,                        -- NULL for bank transfers
  amount DECIMAL(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | in_progress | success | failed
  method TEXT NOT NULL,                     -- 'Credit Card' | 'Bank Transfer' | 'Cheque'
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------
-- JOBS — ServiceM8 job references
-- -------------------------------------------
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sm8_job_id TEXT,                         -- ServiceM8 job UUID
  sm8_client_id TEXT,                      -- ServiceM8 company/contact UUID
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------
-- INVOICES — Xero invoice references
-- -------------------------------------------
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  xero_invoice_id TEXT,                    -- Xero invoice UUID
  xero_contact_id TEXT,                    -- Xero contact UUID
  amount DECIMAL(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------
-- SYNC LOGS — Full audit trail
-- -------------------------------------------
CREATE TABLE sync_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  service TEXT NOT NULL,                   -- 'eway' | 'servicem8' | 'xero'
  action TEXT NOT NULL,                    -- e.g. 'create_job', 'create_invoice', 'process_payment'
  request_payload JSONB,
  response_payload JSONB,
  status TEXT NOT NULL,                    -- 'pending' | 'success' | 'failed'
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------
-- INDEXES
-- -------------------------------------------
CREATE INDEX idx_orders_unique_code ON orders(unique_code);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_payments_order_id ON payments(order_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_jobs_order_id ON jobs(order_id);
CREATE INDEX idx_jobs_sm8_job_id ON jobs(sm8_job_id);
CREATE INDEX idx_invoices_order_id ON invoices(order_id);
CREATE INDEX idx_invoices_xero_invoice_id ON invoices(xero_invoice_id);
CREATE INDEX idx_sync_logs_order_id ON sync_logs(order_id);
CREATE INDEX idx_sync_logs_service ON sync_logs(service);
CREATE INDEX idx_sync_logs_status ON sync_logs(status);

-- -------------------------------------------
-- AUTO-UPDATE updated_at TRIGGER
-- -------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -------------------------------------------
-- ROW LEVEL SECURITY (Phase 2 — Dashboard)
-- -------------------------------------------
-- Enable RLS on all tables (policies added when dashboard is built)
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (used by the API routes)
-- No additional policies needed for V1 since we use the service role key
