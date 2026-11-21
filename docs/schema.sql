-- ============================================================
-- GnuDash+ PostgreSQL Schema
-- ============================================================
-- Conventions:
--   - All private tables carry user_id (FK → users)
--   - Shared cache tables have no user_id (one row per ticker, global)
--   - Holdings and balances are monthly snapshots — append-only, never delete past data
--   - Transactions are immutable; Plaid removals are soft-deleted via removed_at
--   - access_token and user_secret should be encrypted at rest (pgcrypto or Supabase Vault)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ============================================================
-- SHARED CACHE TABLES (no user_id — global, one row per ticker)
-- ============================================================

CREATE TABLE price_history (
  symbol          TEXT        NOT NULL,
  month           CHAR(7)     NOT NULL,   -- 'YYYY-MM'
  price           NUMERIC     NOT NULL,
  PRIMARY KEY (symbol, month)
);

-- ============================================================
-- SECURITIES (replaces ticker_info + ticker_classifications + fund_holdings)
--
-- user_id = NULL  →  global cache entry (auto-fetched from Yahoo Finance, shared)
-- user_id = <id>  →  user-created custom security or user override of a global entry
--
-- Resolution in code: user row takes precedence over global row for the same ticker.
-- Manual entry: insert with user_id set and fetched_at NULL (no Yahoo data).
--
-- classifications JSONB supports blended funds with multiple weighted allocations:
--   [{weight, asset_class, region, class_detailed, sector}]
--   Auto-populated by Claude; user-editable.
--
-- fund_summary JSONB stores pre-computed asset breakdown for funds/ETFs:
--   {stock_pct, bond_pct, cash_pct, other_pct, total_mapped, source}
--   Populated when fund_constituents rows exist for this ticker.
-- ============================================================

CREATE TABLE securities (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker          TEXT        NOT NULL,
  user_id         UUID        REFERENCES users(id) ON DELETE CASCADE,  -- NULL = global
  -- market data (auto-fetched from Yahoo Finance)
  name            TEXT,
  quote_type      TEXT,                   -- EQUITY, ETF, MUTUALFUND, CRYPTOCURRENCY, MONEYMARKET
  currency        TEXT,
  fund_family     TEXT,
  category        TEXT,
  legal_type      TEXT,
  expense_ratio   NUMERIC,
  total_assets    NUMERIC,
  yield           NUMERIC,
  week_change_52  NUMERIC,
  industry        TEXT,
  country         TEXT,
  website         TEXT,
  beta            NUMERIC,
  forward_pe      NUMERIC,
  trailing_eps    NUMERIC,
  description     TEXT,
  fetched_at      TIMESTAMPTZ,
  -- portfolio classification (auto-classified by Claude or user-edited)
  classifications JSONB,
  -- fund composition summary (populated for ETFs/mutual funds that have constituents)
  fund_summary    JSONB,
  UNIQUE NULLS NOT DISTINCT (ticker, user_id)
);

CREATE INDEX securities_ticker_idx   ON securities(ticker);
CREATE INDEX securities_user_id_idx  ON securities(user_id) WHERE user_id IS NOT NULL;

-- ============================================================
-- FUND CONSTITUENTS (x-ray table: fund → underlying holdings)
--
-- Enables x-ray queries:
--   Forward:  "What does VTSAX hold?" → WHERE fund_ticker = 'VTSAX'
--   Reverse:  "Which of my funds contain GOOG?" → WHERE constituent_ticker = 'GOOG'
--   Exposure: JOIN to holdings on fund_ticker = symbol, multiply market_value * pct
--
-- constituent_ticker may be empty string for bonds/instruments with no ticker symbol.
-- ============================================================

CREATE TABLE fund_constituents (
  fund_ticker         TEXT    NOT NULL,
  constituent_ticker  TEXT    NOT NULL DEFAULT '',  -- empty string for untickered instruments
  name                TEXT    NOT NULL DEFAULT '',  -- display name, disambiguates empty tickers
  pct                 NUMERIC,                      -- fraction of fund (e.g. 0.03 = 3%)
  asset_category      TEXT,                         -- EC (Equity), DBT (Debt), CASH, etc.
  issuer_category     TEXT,                         -- UST (US Treasury), etc.
  PRIMARY KEY (fund_ticker, constituent_ticker, name)
);


-- ============================================================
-- USERS (managed by auth provider; minimal local record)
-- ============================================================

CREATE TABLE users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT        UNIQUE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- BROKERAGE CONNECTIONS (OAuth credentials, one per institution link)
-- One connection → many accounts
-- ============================================================

CREATE TABLE brokerage_connections (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source            TEXT        NOT NULL,   -- 'plaid' | 'snaptrade'
  external_id       TEXT        NOT NULL,   -- Plaid item_id or SnapTrade authorization_id
  access_token      TEXT,                   -- encrypted (Plaid only)
  user_secret       TEXT,                   -- encrypted (SnapTrade only)
  snaptrade_user_id TEXT,                   -- SnapTrade only
  institution       TEXT,
  display_name      TEXT,
  cursor            TEXT,                   -- Plaid incremental sync cursor
  last_synced_at    TIMESTAMPTZ,
  connected_at      TIMESTAMPTZ,
  UNIQUE (user_id, source, external_id)
);

CREATE INDEX brokerage_connections_user_id_idx ON brokerage_connections(user_id);


-- ============================================================
-- ACCOUNTS (unified — all sources, all types)
--
-- account_category values:
--   brokerage    taxable investment accounts
--   retirement   IRA, 401k, 403b, HSA
--   crypto       crypto wallets / exchange accounts
--   bank         checking, savings, money market
--   credit_card
--   real_estate
--   manual       manually entered with no specific category
-- ============================================================

CREATE TABLE accounts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id    UUID        REFERENCES brokerage_connections(id) ON DELETE SET NULL,
  external_id      TEXT,                   -- Plaid accountId, SnapTrade account UUID, etc.
  source           TEXT        NOT NULL,   -- 'plaid' | 'snaptrade' | 'manual'
  account_category TEXT        NOT NULL,
  account_type     TEXT,                   -- 'roth_ira', 'traditional_401k', 'checking', etc.
  name             TEXT,
  display_name     TEXT,
  institution      TEXT,
  number           TEXT,                   -- masked account number
  currency         TEXT        DEFAULT 'USD',
  hidden           BOOLEAN     DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, source, external_id)
);

CREATE INDEX accounts_user_id_idx        ON accounts(user_id);
CREATE INDEX accounts_connection_id_idx  ON accounts(connection_id);


-- ============================================================
-- MONTHLY HOLDINGS (all account types — unified)
--
-- Brokerage/retirement/crypto: one row per (account_id, month, symbol)
--   symbol, quantity, price all populated; market_value = quantity * price
--
-- Bank/credit card/real estate: one row per (account_id, month)
--   symbol and quantity are NULL; market_value is the account balance
--   (negative for credit cards)
--
-- Account balance for any type: SELECT SUM(market_value) GROUP BY account_id, month
--
-- Append-only — upsert current month on each sync, never touch past months.
-- NULLS NOT DISTINCT (Postgres 15+) treats (account_id, month, NULL) as unique.
-- ============================================================

CREATE TABLE holdings (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month           CHAR(7)     NOT NULL,   -- 'YYYY-MM'
  symbol          TEXT,                   -- NULL for bank / credit card / real estate
  description     TEXT,
  quantity        NUMERIC,                -- NULL for non-security accounts
  price           NUMERIC,                -- NULL for non-security accounts
  market_value    NUMERIC,
  cost_basis      NUMERIC,
  currency        TEXT,
  UNIQUE NULLS NOT DISTINCT (account_id, month, symbol)
);

CREATE INDEX holdings_user_month_idx    ON holdings(user_id, month);
CREATE INDEX holdings_account_month_idx ON holdings(account_id, month);
CREATE INDEX holdings_symbol_idx        ON holdings(symbol) WHERE symbol IS NOT NULL;


-- ============================================================
-- TRANSACTIONS (bank, credit card, and investment — unified)
-- Never hard-delete. Plaid removals use soft-delete via removed_at.
-- Pending→posted: ON CONFLICT (id) DO UPDATE SET pending = false, amount = EXCLUDED.amount
-- Investment-specific columns are NULL for bank/credit card rows.
-- ============================================================

CREATE TABLE transactions (
  id               TEXT        PRIMARY KEY,   -- Plaid/SnapTrade ID, or gen_random_uuid() for manual
  account_id       UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date             DATE        NOT NULL,
  amount           NUMERIC     NOT NULL,
  name             TEXT,
  merchant_name    TEXT,
  pending          BOOLEAN     DEFAULT false,
  removed_at       TIMESTAMPTZ,              -- soft-delete for Plaid-removed transactions
  -- investment-specific (NULL for bank / credit card)
  transaction_type TEXT,                    -- BUY, SELL, DIVIDEND, CONTRIBUTION, INTEREST, etc.
  symbol           TEXT,
  quantity         NUMERIC,
  price_per_share  NUMERIC,
  fee              NUMERIC,
  currency         TEXT
);

CREATE INDEX transactions_user_date_idx    ON transactions(user_id, date DESC) WHERE removed_at IS NULL;
CREATE INDEX transactions_account_id_idx   ON transactions(account_id);
CREATE INDEX transactions_symbol_idx       ON transactions(symbol) WHERE symbol IS NOT NULL;


-- ============================================================
-- REAL ESTATE
-- Estimated value over time lives in holdings (symbol=NULL, market_value=zestimate)
-- via the linked accounts row. Improvements are tracked separately for cost-basis.
-- ============================================================

CREATE TABLE real_estate_properties (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname        TEXT,
  address         TEXT,
  city            TEXT,
  state           TEXT,
  zip             TEXT,
  purchase_price  NUMERIC,
  purchase_date   DATE,
  last_synced_at  TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE real_estate_improvements (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID        NOT NULL REFERENCES real_estate_properties(id) ON DELETE CASCADE,
  description     TEXT,
  date            DATE,
  cost            NUMERIC
);


-- ============================================================
-- PORTFOLIO VIEWS
-- ============================================================

CREATE TABLE portfolio_views (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE portfolio_view_accounts (
  view_id         UUID        NOT NULL REFERENCES portfolio_views(id) ON DELETE CASCADE,
  account_id      UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (view_id, account_id)
);


