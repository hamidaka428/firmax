-- ============================================================================
--  schema.sql — Firmax, multi-tenant invoicing & ERP (PostgreSQL 16+)
--  Safe to run repeatedly (CREATE ... IF NOT EXISTS + ADD COLUMN IF NOT EXISTS).
--
--  Normal run (keeps existing data):
--     docker cp schema.sql erp_postgres:/tmp/schema.sql
--     docker exec -it erp_postgres psql -U erp_admin -d erp_database -f /tmp/schema.sql
--
--  FULL RESET (drops all tables and recreates them with demo data):
--     docker exec -it erp_postgres psql -U erp_admin -d erp_database -v reset=1 -f /tmp/schema.sql
-- ============================================================================
\set ON_ERROR_STOP on
\encoding UTF8

BEGIN;
SET LOCAL client_min_messages = warning;  -- no "already exists, skipping" noise

\if :{?reset}
  DROP TABLE IF EXISTS invoice_items, invoices, bank_accounts, invoice_series, contract_items, contracts, contract_templates, products, clients, companies,
                       sessions, stripe_events, user_tokens, users CASCADE;
  DROP FUNCTION IF EXISTS next_invoice_number(INTEGER);
  DROP FUNCTION IF EXISTS next_proforma_number(INTEGER);
\endif

-- ----------------------------------------------------------------------------
-- 0. USERS AND SESSIONS
-- ----------------------------------------------------------------------------
-- Old database from a previous version / another library (e.g. users.id is a UUID): the tables are renamed
-- to *_legacy_<timestamp> so no data is lost, and recreated in the current format.
DO $legacy_auth$
DECLARE
  t TEXT;
  idx RECORD;
  suffix TEXT := '_legacy_' || to_char(now(), 'YYYYMMDDHH24MISS');
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'sessions', 'user_tokens'] LOOP
    IF EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = t
            AND ((column_name = 'id' AND data_type <> 'integer')
              OR (column_name = 'user_id' AND data_type <> 'integer')))
       OR (t <> 'users' AND EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id' AND data_type <> 'integer')
         AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t))
    THEN
      FOR idx IN SELECT ic.relname FROM pg_index i
                   JOIN pg_class ic ON ic.oid = i.indexrelid
                   JOIN pg_class tc ON tc.oid = i.indrelid
                   JOIN pg_namespace n ON n.oid = tc.relnamespace
                  WHERE n.nspname = 'public' AND tc.relname = t LOOP
        EXECUTE format('ALTER INDEX %I RENAME TO %I', idx.relname, left(idx.relname || suffix, 63));
      END LOOP;
      EXECUTE format('ALTER TABLE %I RENAME TO %I', t, t || suffix);
      RAISE WARNING 'Old table % was renamed to % (incompatible format).', t, t || suffix;
    END IF;
  END LOOP;
END
$legacy_auth$;

CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY);
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email                  VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS password_hash          VARCHAR(255) NOT NULL DEFAULT '',  -- scrypt$N$r$p$salt$hash
  ADD COLUMN IF NOT EXISTS name                   VARCHAR(150) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_login_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verified_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at             TIMESTAMPTZ  NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users (lower(email));

-- Migration: subscriptions and Terms acceptance were removed (the app is self-hosted and free).
-- Dropping the columns also drops their indexes and CHECK constraints.
ALTER TABLE users
  DROP COLUMN IF EXISTS plan,
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS stripe_subscription_id,
  DROP COLUMN IF EXISTS subscription_status,
  DROP COLUMN IF EXISTS subscription_interval,
  DROP COLUMN IF EXISTS current_period_end,
  DROP COLUMN IF EXISTS cancel_at_period_end,
  DROP COLUMN IF EXISTS subscription_event_at,
  DROP COLUMN IF EXISTS terms_version,
  DROP COLUMN IF EXISTS terms_accepted_at;

-- Login sessions: we store only the SHA-256 of the token, never the token itself
CREATE TABLE IF NOT EXISTS sessions (id SERIAL PRIMARY KEY);
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS token_hash CHAR(64)     NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS user_agent VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ  NOT NULL DEFAULT now() + INTERVAL '30 days';
CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_token ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- One-time links: password reset and email confirmation (only the SHA-256 is stored)
CREATE TABLE IF NOT EXISTS user_tokens (id SERIAL PRIMARY KEY);
ALTER TABLE user_tokens
  ADD COLUMN IF NOT EXISTS user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS kind       VARCHAR(20)  NOT NULL DEFAULT 'reset' CHECK (kind IN ('reset', 'verify')),
  ADD COLUMN IF NOT EXISTS token_hash CHAR(64)     NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ  NOT NULL DEFAULT now() + INTERVAL '1 hour',
  ADD COLUMN IF NOT EXISTS used_at    TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_tokens_hash ON user_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_user_tokens_user ON user_tokens (user_id, kind);

-- Migration: Stripe webhook bookkeeping is no longer used
DROP TABLE IF EXISTS stripe_events;

-- ----------------------------------------------------------------------------
-- 1. COMPANIES (tenants)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (id SERIAL PRIMARY KEY);
CREATE TABLE IF NOT EXISTS clients (id SERIAL PRIMARY KEY);
-- Column names from earlier versions: eik → reg_no, mol → representative
DO $rename_cols$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies', 'clients'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'eik')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'reg_no') THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN eik TO reg_no', t);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'mol')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'representative') THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN mol TO representative', t);
    END IF;
  END LOOP;
END
$rename_cols$;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS name        VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reg_no      VARCHAR(30)  NOT NULL DEFAULT '',  -- company registration number / tax ID
  ADD COLUMN IF NOT EXISTS vat_number  VARCHAR(30)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city        VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address     VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS country     VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS representative VARCHAR(150) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone       VARCHAR(50)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS email       VARCHAR(150) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bank_name   VARCHAR(150) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS iban        VARCHAR(40)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bic         VARCHAR(20)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS currency    VARCHAR(5)   NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS invoice_seq INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS proforma_seq INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS templates_seeded BOOLEAN NOT NULL DEFAULT false, -- sample templates have been added
  ADD COLUMN IF NOT EXISTS logo_path   VARCHAR(500),                        -- logo for invoices and contracts (storage/uploads/logos/…)
  ADD COLUMN IF NOT EXISTS owner_id    INTEGER REFERENCES users(id) ON DELETE CASCADE, -- the user who owns the company
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ  NOT NULL DEFAULT now();

-- ----------------------------------------------------------------------------
-- 2. CLIENTS
-- ----------------------------------------------------------------------------
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS name       VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reg_no     VARCHAR(30)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS vat_number VARCHAR(30)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city       VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address    VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS country    VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS representative VARCHAR(150) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone      VARCHAR(50)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS email      VARCHAR(150) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS notes      TEXT         NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ  NOT NULL DEFAULT now();

-- ----------------------------------------------------------------------------
-- 3. INVENTORY / PRODUCTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY);
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS sku             VARCHAR(50),
  ADD COLUMN IF NOT EXISTS name            VARCHAR(255)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS category        VARCHAR(100)  NOT NULL DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS unit            VARCHAR(20)   NOT NULL DEFAULT 'pcs',
  ADD COLUMN IF NOT EXISTS qty_in_stock    NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qty_in_stock >= 0),
  ADD COLUMN IF NOT EXISTS min_stock_level NUMERIC(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_price      NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ   NOT NULL DEFAULT now();

-- ----------------------------------------------------------------------------
-- 4. CONTRACTS
-- ----------------------------------------------------------------------------
-- Contract templates. The text contains fields such as {{client.name}}, {{contract.amount}}, etc.
CREATE TABLE IF NOT EXISTS contract_templates (id SERIAL PRIMARY KEY);
ALTER TABLE contract_templates
  ADD COLUMN IF NOT EXISTS company_id     INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS name           VARCHAR(150)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contract_type  VARCHAR(20)   NOT NULL DEFAULT 'sale',
  ADD COLUMN IF NOT EXISTS default_title  VARCHAR(255)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS default_months INTEGER       CHECK (default_months IS NULL OR default_months BETWEEN 1 AND 600),
  ADD COLUMN IF NOT EXISTS body           TEXT          NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS contracts (id SERIAL PRIMARY KEY);
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS client_id       INTEGER REFERENCES clients(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS contract_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS title           VARCHAR(255)  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contract_type   VARCHAR(20)   NOT NULL DEFAULT 'sale',
  ADD COLUMN IF NOT EXISTS start_date      DATE          NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS end_date        DATE,
  ADD COLUMN IF NOT EXISTS total_price     NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status          VARCHAR(20)   NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS file_path       VARCHAR(500),
  ADD COLUMN IF NOT EXISTS file_name       VARCHAR(255),
  ADD COLUMN IF NOT EXISTS notes           TEXT          NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS template_id     INTEGER REFERENCES contract_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS body            TEXT          NOT NULL DEFAULT '', -- the filled-in text (unchanged when the template is edited)
  ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  -- Recurring billing: every billing_months months (0 = off), first invoice on billing_start,
  -- billing_issued = number of periods already invoiced. Next period = billing_start + issued × months.
  ADD COLUMN IF NOT EXISTS billing_months   SMALLINT      NOT NULL DEFAULT 0 CHECK (billing_months IN (0, 1, 3, 6, 12)),
  ADD COLUMN IF NOT EXISTS billing_start    DATE,
  ADD COLUMN IF NOT EXISTS billing_issued   INTEGER       NOT NULL DEFAULT 0 CHECK (billing_issued >= 0),
  ADD COLUMN IF NOT EXISTS billing_due_days SMALLINT      NOT NULL DEFAULT 14 CHECK (billing_due_days BETWEEN 0 AND 365),
  ADD COLUMN IF NOT EXISTS billing_vat_rate NUMERIC(5,2)  NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS billing_vat_exempt_reason VARCHAR(255) NOT NULL DEFAULT '';

-- An early version of the table had one product per contract (product_id / quantity).
-- Line items now live in contract_items, so drop NOT NULL if those columns still exist.
DO $legacy$
DECLARE col TEXT;
BEGIN
  FOREACH col IN ARRAY ARRAY['product_id', 'quantity'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'contracts' AND column_name = col) THEN
      EXECUTE format('ALTER TABLE contracts ALTER COLUMN %I DROP NOT NULL', col);
    END IF;
  END LOOP;
END
$legacy$;

CREATE TABLE IF NOT EXISTS contract_items (
  id             SERIAL PRIMARY KEY,
  contract_id    INTEGER       NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  product_id     INTEGER       REFERENCES products(id) ON DELETE SET NULL,
  description    VARCHAR(255)  NOT NULL,
  unit           VARCHAR(20)   NOT NULL DEFAULT 'pcs',
  quantity       NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price     NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total     NUMERIC(14,2) NOT NULL DEFAULT 0,
  position       INTEGER       NOT NULL DEFAULT 1,
  stock_deducted BOOLEAN       NOT NULL DEFAULT FALSE
);

-- ----------------------------------------------------------------------------
-- 5. INVOICES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (id SERIAL PRIMARY KEY);
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS company_id     INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS client_id      INTEGER REFERENCES clients(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS contract_id    INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(10),
  ADD COLUMN IF NOT EXISTS issue_date     DATE          NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS due_date       DATE,
  ADD COLUMN IF NOT EXISTS subtotal       NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_rate       NUMERIC(5,2)  NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS vat_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status         VARCHAR(20)   NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30)   NOT NULL DEFAULT 'bank_transfer',
  ADD COLUMN IF NOT EXISTS paid_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS file_path      VARCHAR(500),
  ADD COLUMN IF NOT EXISTS file_name      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS notes          TEXT          NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS vat_exempt_reason VARCHAR(255) NOT NULL DEFAULT '',  -- VAT exemption note when the rate is 0%
  -- Document type: invoice, credit/debit note or proforma (not a tax document)
  ADD COLUMN IF NOT EXISTS doc_type       VARCHAR(20)   NOT NULL DEFAULT 'invoice'
        CHECK (doc_type IN ('invoice', 'credit_note', 'debit_note', 'proforma')),
  -- Note → the invoice it amends; invoice → the proforma it was issued from
  ADD COLUMN IF NOT EXISTS related_invoice_id INTEGER REFERENCES invoices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS note_reason    VARCHAR(500)  NOT NULL DEFAULT '',  -- reason for issuing the note
  -- Number series: 'main' (invoices and notes share numbering), 's<id>' (additional series), 'proforma'
  ADD COLUMN IF NOT EXISTS series_key     VARCHAR(30)   NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS billing_period_start DATE, -- period start for a recurring invoice from a contract
  ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ   NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS invoice_items (
  id          SERIAL PRIMARY KEY,
  invoice_id  INTEGER       NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id  INTEGER       REFERENCES products(id) ON DELETE SET NULL,
  description VARCHAR(255)  NOT NULL,
  unit        VARCHAR(20)   NOT NULL DEFAULT 'pcs',
  quantity    NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price  NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total  NUMERIC(14,2) NOT NULL DEFAULT 0,
  position    INTEGER       NOT NULL DEFAULT 1
);

-- ----------------------------------------------------------------------------
-- 6. INDEXES
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_clients_company        ON clients(company_id);
CREATE INDEX IF NOT EXISTS idx_products_company       ON products(company_id);
CREATE INDEX IF NOT EXISTS idx_contracts_company      ON contracts(company_id, end_date);
CREATE INDEX IF NOT EXISTS idx_contracts_client       ON contracts(client_id);
CREATE INDEX IF NOT EXISTS idx_contract_templates_co  ON contract_templates(company_id, name);
CREATE INDEX IF NOT EXISTS idx_contract_items_ct      ON contract_items(contract_id);
CREATE INDEX IF NOT EXISTS idx_invoices_company       ON invoices(company_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_client        ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_contract      ON invoices(contract_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_inv      ON invoice_items(invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_company_sku      ON products(company_id, sku);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contracts_company_number  ON contracts(company_id, contract_number);
-- The number is unique within its series (invoices/notes and proformas are numbered separately)
DROP INDEX IF EXISTS uq_invoices_company_number;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_series_number    ON invoices(company_id, series_key, invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_related ON invoices(related_invoice_id) WHERE related_invoice_id IS NOT NULL;
-- A contract period is invoiced only once (protection against double generation)
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_contract_period
  ON invoices(contract_id, billing_period_start) WHERE billing_period_start IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_billing ON contracts(billing_months) WHERE billing_months > 0;

-- ----------------------------------------------------------------------------
-- 6a. ADDITIONAL BANK ACCOUNTS AND NUMBER SERIES
--     The main account is in companies (iban/bank_name/bic); these are additional ones (e.g. at another bank).
--     Number series = a separate numbering range (e.g. per branch). The main one starts at 0000000001,
--     additional ones start at a chosen number (e.g. 2000000001). Ranges must not overlap.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bank_accounts (
  id         SERIAL PRIMARY KEY,
  company_id INTEGER      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label      VARCHAR(100) NOT NULL DEFAULT '',
  bank_name  VARCHAR(150) NOT NULL DEFAULT '',
  iban       VARCHAR(40)  NOT NULL,
  bic        VARCHAR(20)  NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_company ON bank_accounts(company_id);

CREATE TABLE IF NOT EXISTS invoice_series (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  next_number BIGINT       NOT NULL CHECK (next_number BETWEEN 1 AND 9999999999),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_series_company ON invoice_series(company_id);

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS bank_account_id INTEGER REFERENCES bank_accounts(id) ON DELETE SET NULL, -- NULL = main account
  -- Email delivery and online link
  ADD COLUMN IF NOT EXISTS share_token     VARCHAR(64),
  ADD COLUMN IF NOT EXISTS sent_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_to         VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS viewed_at       TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_share_token ON invoices(share_token) WHERE share_token IS NOT NULL;

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS billing_auto_email BOOLEAN NOT NULL DEFAULT false, -- recurring invoices are emailed to the client automatically
  ADD COLUMN IF NOT EXISTS share_token        VARCHAR(64),
  ADD COLUMN IF NOT EXISTS sent_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_to            VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS viewed_at          TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_contracts_share_token ON contracts(share_token) WHERE share_token IS NOT NULL;


-- ----------------------------------------------------------------------------
-- 6b. CODES: English codes for statuses, types and payment methods
--     (earlier versions stored Bulgarian words — converted here, idempotently)
-- ----------------------------------------------------------------------------
DO $codes$
DECLARE r RECORD;
BEGIN
  -- Drop old CHECK constraints on these columns (they listed the old values)
  FOR r IN SELECT c.conrelid::regclass::text AS tbl, c.conname
             FROM pg_constraint c
            WHERE c.contype = 'c'
              AND c.conrelid::regclass::text IN ('contracts', 'contract_templates', 'invoices')
              AND pg_get_constraintdef(c.oid) ~ '(status|contract_type|payment_method)'
              AND c.conname NOT LIKE 'ck\_%' LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END
$codes$;

UPDATE contracts SET status = CASE status WHEN U&'\0410\041A\0422\0418\0412\0415\041D' THEN 'active' ELSE 'completed' END
 WHERE status NOT IN ('active', 'completed');
UPDATE contracts SET contract_type = CASE contract_type WHEN U&'\041D\0430\0435\043C' THEN 'rental' WHEN U&'\0423\0441\043B\0443\0433\0430' THEN 'service' ELSE 'sale' END
 WHERE contract_type NOT IN ('rental', 'sale', 'service');
UPDATE contract_templates SET contract_type = CASE contract_type WHEN U&'\041D\0430\0435\043C' THEN 'rental' WHEN U&'\0423\0441\043B\0443\0433\0430' THEN 'service' ELSE 'sale' END
 WHERE contract_type NOT IN ('rental', 'sale', 'service');
UPDATE invoices SET status = CASE status WHEN U&'\041F\041B\0410\0422\0415\041D\0410' THEN 'paid' WHEN U&'\0410\041D\0423\041B\0418\0420\0410\041D\0410' THEN 'cancelled' ELSE 'pending' END
 WHERE status NOT IN ('pending', 'paid', 'cancelled');
UPDATE invoices SET payment_method = CASE payment_method WHEN U&'\0412 \0431\0440\043E\0439' THEN 'cash' WHEN U&'\041A\0430\0440\0442\0430' THEN 'card' ELSE 'bank_transfer' END
 WHERE payment_method NOT IN ('bank_transfer', 'cash', 'card');
ALTER TABLE contracts ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE contracts ALTER COLUMN contract_type SET DEFAULT 'sale';
ALTER TABLE contract_templates ALTER COLUMN contract_type SET DEFAULT 'sale';
ALTER TABLE invoices ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE invoices ALTER COLUMN payment_method SET DEFAULT 'bank_transfer';

ALTER TABLE contracts DROP CONSTRAINT IF EXISTS ck_contracts_status;
ALTER TABLE contracts ADD CONSTRAINT ck_contracts_status CHECK (status IN ('active', 'completed'));
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS ck_contracts_type;
ALTER TABLE contracts ADD CONSTRAINT ck_contracts_type CHECK (contract_type IN ('rental', 'sale', 'service'));
ALTER TABLE contract_templates DROP CONSTRAINT IF EXISTS ck_contract_templates_type;
ALTER TABLE contract_templates ADD CONSTRAINT ck_contract_templates_type CHECK (contract_type IN ('rental', 'sale', 'service'));
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS ck_invoices_status;
ALTER TABLE invoices ADD CONSTRAINT ck_invoices_status CHECK (status IN ('pending', 'paid', 'cancelled'));
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS ck_invoices_payment_method;
ALTER TABLE invoices ADD CONSTRAINT ck_invoices_payment_method CHECK (payment_method IN ('bank_transfer', 'cash', 'card'));
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS ck_invoices_vat_rate;
ALTER TABLE invoices ADD CONSTRAINT ck_invoices_vat_rate CHECK (vat_rate BETWEEN 0 AND 100);

-- ----------------------------------------------------------------------------
-- 7. ATOMIC INVOICE NUMBERING (10 digits, per company, no gaps on ROLLBACK)
--    Usage: SELECT next_invoice_number($1)  -> '0000000001'
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION next_invoice_number(p_company_id INTEGER)
RETURNS VARCHAR AS $fn$
DECLARE
  v_next INTEGER;
BEGIN
  UPDATE companies SET invoice_seq = invoice_seq + 1
   WHERE id = p_company_id
   RETURNING invoice_seq INTO v_next;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'Company with id % does not exist', p_company_id;
  END IF;

  RETURN LPAD(v_next::TEXT, 10, '0');
END;
$fn$ LANGUAGE plpgsql;

-- Separate numbering for proformas (not tax documents, so they don't break the invoice sequence)
CREATE OR REPLACE FUNCTION next_proforma_number(p_company_id INTEGER)
RETURNS VARCHAR AS $fn$
DECLARE
  v_next INTEGER;
BEGIN
  UPDATE companies SET proforma_seq = proforma_seq + 1
   WHERE id = p_company_id
   RETURNING proforma_seq INTO v_next;
  IF v_next IS NULL THEN
    RAISE EXCEPTION 'Company with id % does not exist', p_company_id;
  END IF;
  RETURN LPAD(v_next::TEXT, 10, '0');
END;
$fn$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 8. DEMO DATA (inserted only once — checked by registration number)
--    Contract dates are relative to CURRENT_DATE.
-- ----------------------------------------------------------------------------
SET LOCAL client_min_messages = notice;

DO $seed$
DECLARE
  v_co1 INTEGER; v_co2 INTEGER;
  v_cl1 INTEGER; v_cl2 INTEGER; v_cl3 INTEGER; v_cl4 INTEGER; v_cl5 INTEGER;
  v_cl6 INTEGER; v_cl7 INTEGER; v_cl8 INTEGER;
  v_ct1 INTEGER; v_ct2 INTEGER; v_ct3 INTEGER; v_ct4 INTEGER; v_ct5 INTEGER; v_ct6 INTEGER;
  v_in  INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM companies WHERE reg_no = 'IE-648213') OR EXISTS (SELECT 1 FROM companies WHERE reg_no = '204512345') THEN
    RAISE NOTICE 'Demo data already present — skipping.';
    RETURN;
  END IF;

  -- Companies
  INSERT INTO companies (name, reg_no, vat_number, city, address, country, representative, phone, email, bank_name, iban, bic, currency)
  VALUES ('Northwind Supply Ltd', 'IE-648213', 'IE6482134T', 'Dublin', '14 Grand Canal Quay, D02 X576', 'Ireland',
          'Emma Walsh', '+353 1 555 0142', 'office@northwind.example',
          'Allied Irish Banks', 'IE29AIBK93115212345678', 'AIBKIE2D', 'EUR')
  RETURNING id INTO v_co1;

  INSERT INTO companies (name, reg_no, vat_number, city, address, country, representative, phone, email, bank_name, iban, bic, currency)
  VALUES ('Blue Harbor Logistics GmbH', 'HRB 184522', 'DE318452276', 'Hamburg', 'Am Sandtorkai 41, 20457', 'Germany',
          'Lukas Becker', '+49 40 555 0190', 'info@blueharbor.example',
          'Commerzbank', 'DE89370400440532013000', 'COBADEFFXXX', 'EUR')
  RETURNING id INTO v_co2;

  -- Clients of Northwind Supply
  INSERT INTO clients (company_id, name, reg_no, vat_number, city, address, country, representative, phone, email)
  VALUES (v_co1, 'Atlas Construction BV', 'KVK 68221467', 'NL862214670B01', 'Rotterdam', 'Wilhelminakade 91', 'Netherlands',
          'Daan de Vries', '+31 10 555 0123', 'office@atlas-construction.example') RETURNING id INTO v_cl1;
  INSERT INTO clients (company_id, name, reg_no, vat_number, city, address, country, representative, phone, email)
  VALUES (v_co1, 'Meridian Freight SA', 'B-82731940', 'ESB82731940', 'Madrid', 'Calle de Alcalá 210', 'Spain',
          'Lucía Martín', '+34 91 555 0178', 'contracts@meridianfreight.example') RETURNING id INTO v_cl2;
  INSERT INTO clients (company_id, name, reg_no, vat_number, city, address, country, representative, phone, email)
  VALUES (v_co1, 'Danube Plastics GmbH', 'FN 412987x', 'ATU64129870', 'Vienna', 'Handelskai 94', 'Austria',
          'Stefan Huber', '+43 1 555 0133', 'sales@danubeplastics.example') RETURNING id INTO v_cl3;
  INSERT INTO clients (company_id, name, reg_no, vat_number, city, address, country, representative, phone, email)
  VALUES (v_co1, 'Foxglove Design Studio', '11834527', '', 'Manchester', '22 Ancoats Street', 'United Kingdom',
          'Olivia Bennett', '+44 161 555 0115', 'hello@foxglove.example') RETURNING id INTO v_cl4;
  INSERT INTO clients (company_id, name, reg_no, vat_number, city, address, country, representative, phone, email)
  VALUES (v_co1, 'Greenfield Agro Ltd', 'IE-702188', 'IE7021884K', 'Cork', 'Unit 4, Little Island Business Park', 'Ireland',
          'Conor Murphy', '+353 21 555 0112', 'office@greenfield-agro.example') RETURNING id INTO v_cl5;

  -- Clients of Blue Harbor Logistics
  INSERT INTO clients (company_id, name, reg_no, vat_number, city, address, country, representative, phone, email)
  VALUES (v_co2, 'Port Services Bremen GmbH', 'HRB 32118', 'DE271183456', 'Bremen', 'Hafenstraße 3', 'Germany',
          'Jonas Wagner', '+49 421 555 0150', 'office@portservices.example') RETURNING id INTO v_cl6;
  INSERT INTO clients (company_id, name, reg_no, vat_number, city, address, country, representative, phone, email)
  VALUES (v_co2, 'Nordic Trade AB', '556812-3471', 'SE556812347101', 'Gothenburg', 'Lindholmspiren 7', 'Sweden',
          'Elin Andersson', '+46 31 555 0100', 'trade@nordictrade.example') RETURNING id INTO v_cl7;
  INSERT INTO clients (company_id, name, reg_no, vat_number, city, address, country, representative, phone, email)
  VALUES (v_co2, 'Kowalski Transport', '7811234567', '', 'Poznań', 'ul. Głogowska 19', 'Poland',
          'Piotr Kowalski', '+48 61 555 0177', 'kowalski.transport@example.example') RETURNING id INTO v_cl8;

  -- Inventory of Northwind Supply (3 products are below the minimum level)
  INSERT INTO products (company_id, sku, name, category, unit, qty_in_stock, min_stock_level, unit_price) VALUES
    (v_co1, 'EL-0001', 'Lenovo ThinkPad E15 laptop',            'Electronics',            'pcs',   14,  5,  879.00),
    (v_co1, 'EL-0002', 'Dell P2423D 24" monitor',               'Electronics',            'pcs',   22,  6,  219.00),
    (v_co1, 'EL-0003', 'Logitech M185 wireless mouse',          'Electronics',            'pcs',    8, 15,   14.90),
    (v_co1, 'OF-0101', 'A4 copy paper 80 g (box of 5 reams)',   'Office supplies',        'box',   46, 20,   18.50),
    (v_co1, 'OF-0102', 'HP 26A black toner',                    'Office supplies',        'pcs',    3,  8,   96.40),
    (v_co1, 'OF-0103', 'A4 lever arch file 8 cm',               'Office supplies',        'pcs',  120, 40,    2.35),
    (v_co1, 'BM-0201', 'Cement 42.5R 25 kg',                    'Building materials',     'bag',  310, 100,   5.80),
    (v_co1, 'BM-0202', 'Plasterboard 12.5 mm 1.2×2.5 m',        'Building materials',     'sheet', 85, 30,    9.20),
    (v_co1, 'TL-0301', 'Bosch GSB 13 RE impact drill',          'Tools',                  'pcs',    6,  4,   79.00),
    (v_co1, 'TL-0302', 'Makita 18V cordless drill driver',      'Tools',                  'pcs',    2,  4,  189.00),
    (v_co1, 'PK-0401', 'Stretch film 23 µm 2.5 kg',             'Packaging',              'roll',  64, 25,    7.90),
    (v_co1, 'PK-0402', 'Cardboard box 40×30×30 cm',             'Packaging',              'pcs',  480, 200,   0.85);

  -- Inventory of Blue Harbor Logistics
  INSERT INTO products (company_id, sku, name, category, unit, qty_in_stock, min_stock_level, unit_price) VALUES
    (v_co2, 'LG-0001', 'Euro pallet 1200×800 mm',          'Pallet equipment', 'pcs',  150, 50, 14.50),
    (v_co2, 'LG-0002', 'Pallet strapping band',            'Pallet equipment', 'roll',  40, 20,  6.20),
    (v_co2, 'LG-0003', 'Plastic container seal',           'Seals',            'pcs',  900, 300, 0.45),
    (v_co2, 'LG-0004', 'Cardboard edge protectors',        'Packaging',        'pack',  18, 25, 11.90);

  -- Contracts of Northwind Supply
  INSERT INTO contracts (company_id, client_id, contract_number, title, contract_type, start_date, end_date, total_price, status, notes)
  VALUES (v_co1, v_cl1, 'CT-2026-0001', 'Supply of office equipment', 'sale',
          CURRENT_DATE - 60, CURRENT_DATE + 120, 3294.00, 'active', 'Delivery of 3 laptops and 3 monitors.')
  RETURNING id INTO v_ct1;
  INSERT INTO contract_items (contract_id, product_id, description, unit, quantity, unit_price, line_total, position, stock_deducted)
  SELECT v_ct1, p.id, p.name, p.unit, v.qty, p.unit_price, ROUND(v.qty * p.unit_price, 2), v.pos, TRUE
    FROM (VALUES ('EL-0001', 3, 1), ('EL-0002', 3, 2)) AS v(sku, qty, pos)
    JOIN products p ON p.company_id = v_co1 AND p.sku = v.sku;

  INSERT INTO contracts (company_id, client_id, contract_number, title, contract_type, start_date, end_date, total_price, status, notes)
  VALUES (v_co1, v_cl2, 'CT-2026-0002', 'Monthly IT infrastructure support', 'service',
          CURRENT_DATE - 175, CURRENT_DATE + 6, 1800.00, 'active', 'Up for renewal by the end of the week.')
  RETURNING id INTO v_ct2;
  INSERT INTO contract_items (contract_id, product_id, description, unit, quantity, unit_price, line_total, position)
  VALUES (v_ct2, NULL, 'IT support subscription – monthly fee', 'month', 6, 300.00, 1800.00, 1);

  INSERT INTO contracts (company_id, client_id, contract_number, title, contract_type, start_date, end_date, total_price, status, notes)
  VALUES (v_co1, v_cl3, 'CT-2025-0014', 'Warehouse equipment rental', 'rental',
          CURRENT_DATE - 400, CURRENT_DATE - 35, 2400.00, 'active', 'Expired — awaiting a renewal decision.')
  RETURNING id INTO v_ct3;
  INSERT INTO contract_items (contract_id, product_id, description, unit, quantity, unit_price, line_total, position)
  VALUES (v_ct3, NULL, 'Warehouse equipment rental – month', 'month', 12, 200.00, 2400.00, 1);

  INSERT INTO contracts (company_id, client_id, contract_number, title, contract_type, start_date, end_date, total_price, status, notes)
  VALUES (v_co1, v_cl5, 'CT-2026-0003', 'Framework agreement for building materials', 'sale',
          CURRENT_DATE - 30, NULL, 948.00, 'active', 'Open-ended framework agreement.')
  RETURNING id INTO v_ct4;
  INSERT INTO contract_items (contract_id, product_id, description, unit, quantity, unit_price, line_total, position, stock_deducted)
  SELECT v_ct4, p.id, p.name, p.unit, v.qty, p.unit_price, ROUND(v.qty * p.unit_price, 2), v.pos, TRUE
    FROM (VALUES ('BM-0201', 100, 1), ('BM-0202', 40, 2)) AS v(sku, qty, pos)
    JOIN products p ON p.company_id = v_co1 AND p.sku = v.sku;

  INSERT INTO contracts (company_id, client_id, contract_number, title, contract_type, start_date, end_date, total_price, status, notes)
  VALUES (v_co1, v_cl4, 'CT-2025-0009', 'Supply of packaging materials', 'sale',
          CURRENT_DATE - 300, CURRENT_DATE - 120, 413.00, 'completed', 'Fulfilled and closed.')
  RETURNING id INTO v_ct5;
  INSERT INTO contract_items (contract_id, product_id, description, unit, quantity, unit_price, line_total, position, stock_deducted)
  SELECT v_ct5, p.id, p.name, p.unit, v.qty, p.unit_price, ROUND(v.qty * p.unit_price, 2), v.pos, TRUE
    FROM (VALUES ('PK-0401', 20, 1), ('PK-0402', 300, 2)) AS v(sku, qty, pos)
    JOIN products p ON p.company_id = v_co1 AND p.sku = v.sku;

  -- Contract of Blue Harbor Logistics
  INSERT INTO contracts (company_id, client_id, contract_number, title, contract_type, start_date, end_date, total_price, status)
  VALUES (v_co2, v_cl6, 'CT-2026-0001', 'Warehousing and cargo handling services', 'service',
          CURRENT_DATE - 90, CURRENT_DATE + 270, 5400.00, 'active')
  RETURNING id INTO v_ct6;
  INSERT INTO contract_items (contract_id, product_id, description, unit, quantity, unit_price, line_total, position)
  VALUES (v_ct6, NULL, 'Warehousing services – monthly fee', 'month', 6, 900.00, 5400.00, 1);

  -- Invoices of Northwind Supply (VAT 23%)
  -- 1) Paid
  INSERT INTO invoices (company_id, client_id, contract_id, invoice_number, issue_date, due_date,
                        subtotal, vat_rate, vat_amount, total_amount, status, payment_method, paid_at, notes)
  VALUES (v_co1, v_cl1, v_ct1, '0000000001', CURRENT_DATE - 45, CURRENT_DATE - 15,
          3294.00, 23, 757.62, 4051.62, 'paid', 'bank_transfer', now() - INTERVAL '20 days',
          'Delivery under contract CT-2026-0001')
  RETURNING id INTO v_in;
  INSERT INTO invoice_items (invoice_id, product_id, description, unit, quantity, unit_price, line_total, position)
  SELECT v_in, p.id, p.name, p.unit, v.qty, p.unit_price, ROUND(v.qty * p.unit_price, 2), v.pos
    FROM (VALUES ('EL-0001', 3, 1), ('EL-0002', 3, 2)) AS v(sku, qty, pos)
    JOIN products p ON p.company_id = v_co1 AND p.sku = v.sku;

  -- 2) Overdue (pending, due 6 days ago)
  INSERT INTO invoices (company_id, client_id, contract_id, invoice_number, issue_date, due_date,
                        subtotal, vat_rate, vat_amount, total_amount, status, payment_method, notes)
  VALUES (v_co1, v_cl2, v_ct2, '0000000002', CURRENT_DATE - 20, CURRENT_DATE - 6,
          300.00, 23, 69.00, 369.00, 'pending', 'bank_transfer', 'Monthly support under CT-2026-0002')
  RETURNING id INTO v_in;
  INSERT INTO invoice_items (invoice_id, product_id, description, unit, quantity, unit_price, line_total, position)
  VALUES (v_in, NULL, 'IT support subscription – monthly fee', 'month', 1, 300.00, 300.00, 1);

  -- 3) Pending (not yet due)
  INSERT INTO invoices (company_id, client_id, contract_id, invoice_number, issue_date, due_date,
                        subtotal, vat_rate, vat_amount, total_amount, status, payment_method, notes)
  VALUES (v_co1, v_cl5, v_ct4, '0000000003', CURRENT_DATE - 5, CURRENT_DATE + 9,
          948.00, 23, 218.04, 1166.04, 'pending', 'bank_transfer', 'Building materials under CT-2026-0003')
  RETURNING id INTO v_in;
  INSERT INTO invoice_items (invoice_id, product_id, description, unit, quantity, unit_price, line_total, position)
  SELECT v_in, p.id, p.name, p.unit, v.qty, p.unit_price, ROUND(v.qty * p.unit_price, 2), v.pos
    FROM (VALUES ('BM-0201', 100, 1), ('BM-0202', 40, 2)) AS v(sku, qty, pos)
    JOIN products p ON p.company_id = v_co1 AND p.sku = v.sku;

  -- 4) Paid (cash), UK client outside the EU — no VAT
  INSERT INTO invoices (company_id, client_id, contract_id, invoice_number, issue_date, due_date,
                        subtotal, vat_rate, vat_amount, total_amount, status, payment_method, paid_at, notes, vat_exempt_reason)
  VALUES (v_co1, v_cl4, v_ct5, '0000000004', CURRENT_DATE - 110, CURRENT_DATE - 80,
          413.00, 0, 0, 413.00, 'paid', 'cash', now() - INTERVAL '95 days',
          'Packaging materials under CT-2025-0009', 'Export outside the EU — exempt (Art. 146, Directive 2006/112/EC)')
  RETURNING id INTO v_in;
  INSERT INTO invoice_items (invoice_id, product_id, description, unit, quantity, unit_price, line_total, position)
  SELECT v_in, p.id, p.name, p.unit, v.qty, p.unit_price, ROUND(v.qty * p.unit_price, 2), v.pos
    FROM (VALUES ('PK-0401', 20, 1), ('PK-0402', 300, 2)) AS v(sku, qty, pos)
    JOIN products p ON p.company_id = v_co1 AND p.sku = v.sku;

  -- 5) Cancelled
  INSERT INTO invoices (company_id, client_id, contract_id, invoice_number, issue_date, due_date,
                        subtotal, vat_rate, vat_amount, total_amount, status, payment_method, notes)
  VALUES (v_co1, v_cl3, v_ct3, '0000000005', CURRENT_DATE - 60, CURRENT_DATE - 30,
          200.00, 23, 46.00, 246.00, 'cancelled', 'bank_transfer', 'Cancelled — issued with the wrong date.')
  RETURNING id INTO v_in;
  INSERT INTO invoice_items (invoice_id, product_id, description, unit, quantity, unit_price, line_total, position)
  VALUES (v_in, NULL, 'Warehouse equipment rental – month', 'month', 1, 200.00, 200.00, 1);

  UPDATE companies SET invoice_seq = 5 WHERE id = v_co1;

  -- Invoice of Blue Harbor Logistics (VAT 19%)
  INSERT INTO invoices (company_id, client_id, contract_id, invoice_number, issue_date, due_date,
                        subtotal, vat_rate, vat_amount, total_amount, status, payment_method, notes)
  VALUES (v_co2, v_cl6, v_ct6, '0000000001', CURRENT_DATE - 4, CURRENT_DATE + 10,
          900.00, 19, 171.00, 1071.00, 'pending', 'bank_transfer', 'Warehousing services under CT-2026-0001')
  RETURNING id INTO v_in;
  INSERT INTO invoice_items (invoice_id, product_id, description, unit, quantity, unit_price, line_total, position)
  VALUES (v_in, NULL, 'Warehousing services – monthly fee', 'month', 1, 900.00, 900.00, 1);

  UPDATE companies SET invoice_seq = 1 WHERE id = v_co2;

  RAISE NOTICE 'Demo data loaded (2 companies).';
END
$seed$;

-- ----------------------------------------------------------------------------
-- 9. MIGRATION OF OLD ROWS (if the tables existed before) + NOT NULL for company_id
-- ----------------------------------------------------------------------------
UPDATE clients   SET company_id = (SELECT MIN(id) FROM companies) WHERE company_id IS NULL;
UPDATE products  SET company_id = (SELECT MIN(id) FROM companies) WHERE company_id IS NULL;
UPDATE contracts SET company_id = (SELECT MIN(id) FROM companies) WHERE company_id IS NULL;
UPDATE invoices  SET company_id = (SELECT MIN(id) FROM companies) WHERE company_id IS NULL;

-- ----------------------------------------------------------------------------
-- Demo user: demo@erp.local / demo12345 — owns the demo companies and any companies
-- without an owner (from versions before sign-up existed). CHANGE/DELETE it in production.
-- ----------------------------------------------------------------------------
INSERT INTO users (email, password_hash, name, email_verified_at)
SELECT 'demo@erp.local', 'scrypt$16384$8$1$XRyKfjufQNKmwei0fy2aAw$OwGt8C8d-TpfgHwqsZhd8XhSIsW2Ix9Efmzu5v5CxQSNT8vbC_brRnYus2DiRHkRJT5OxWeGxnBqFuex_nuiLA', 'Demo User', now()
 WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = 'demo@erp.local')
   AND EXISTS (SELECT 1 FROM companies WHERE owner_id IS NULL);
UPDATE companies SET owner_id = (SELECT id FROM users WHERE lower(email) = 'demo@erp.local')
 WHERE owner_id IS NULL AND EXISTS (SELECT 1 FROM users WHERE lower(email) = 'demo@erp.local');
CREATE INDEX IF NOT EXISTS idx_companies_owner ON companies (owner_id);
UPDATE users SET email_verified_at = created_at WHERE lower(email) = 'demo@erp.local' AND email_verified_at IS NULL;

ALTER TABLE clients   ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE products  ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE contracts ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE invoices  ALTER COLUMN company_id SET NOT NULL;

COMMIT;

-- Quick check
SELECT c.name AS "Company",
       (SELECT COUNT(*) FROM clients   WHERE company_id = c.id) AS "Clients",
       (SELECT COUNT(*) FROM products  WHERE company_id = c.id) AS "Products",
       (SELECT COUNT(*) FROM contracts WHERE company_id = c.id) AS "Contracts",
       (SELECT COUNT(*) FROM invoices  WHERE company_id = c.id) AS "Invoices"
  FROM companies c ORDER BY c.id;
