# Query Reference

Key queries for the GnuDash+ schema. See `schema.sql` for table definitions.

---

## Holdings & Balances

### Account balance for any account type
Works for brokerage, bank, credit card, real estate — no special cases needed.
```sql
SELECT account_id, SUM(market_value) AS balance
FROM holdings
WHERE user_id = $1 AND month = '2026-05'
GROUP BY account_id;
```

### Net worth breakdown by asset category
```sql
SELECT a.account_category, SUM(h.market_value) AS value
FROM holdings h
JOIN accounts a ON a.id = h.account_id
WHERE h.user_id = $1 AND h.month = '2026-05'
GROUP BY a.account_category
ORDER BY value DESC;
```

### All holdings for a user in a given month
```sql
SELECT a.name, a.account_category, h.symbol, h.description,
       h.quantity, h.price, h.market_value, h.cost_basis
FROM holdings h
JOIN accounts a ON a.id = h.account_id
WHERE h.user_id = $1 AND h.month = '2026-05' AND h.market_value IS NOT NULL
ORDER BY h.market_value DESC;
```

### Net worth over time (all months)
```sql
SELECT month, SUM(market_value) AS net_worth
FROM holdings
WHERE user_id = $1
GROUP BY month
ORDER BY month;
```

---

## Securities

### Resolve a security — user override takes precedence over global entry
```sql
SELECT * FROM securities
WHERE ticker = $1 AND (user_id = $2 OR user_id IS NULL)
ORDER BY user_id NULLS LAST
LIMIT 1;
```

### Batch resolve securities for a set of tickers
```sql
SELECT DISTINCT ON (ticker) *
FROM securities
WHERE ticker = ANY($1) AND (user_id = $2 OR user_id IS NULL)
ORDER BY ticker, user_id NULLS LAST;
```

---

## X-Ray (Fund Constituent Exposure)

### What does a fund hold?
```sql
SELECT constituent_ticker, name, pct, asset_category
FROM fund_constituents
WHERE fund_ticker = 'VTSAX'
ORDER BY pct DESC;
```

### Which funds in a user's portfolio contain a given security?
```sql
SELECT h.symbol AS fund, h.market_value, fc.pct,
       h.market_value * fc.pct AS indirect_exposure
FROM holdings h
JOIN fund_constituents fc ON fc.fund_ticker = h.symbol
WHERE h.user_id = $1 AND h.month = '2026-05'
  AND fc.constituent_ticker = 'GOOG';
```

### Full x-ray: total indirect exposure to every underlying security
```sql
SELECT fc.constituent_ticker, fc.name,
       SUM(h.market_value * fc.pct) AS indirect_exposure
FROM holdings h
JOIN fund_constituents fc ON fc.fund_ticker = h.symbol
WHERE h.user_id = $1 AND h.month = '2026-05'
GROUP BY fc.constituent_ticker, fc.name
ORDER BY indirect_exposure DESC;
```

### Combined direct + indirect exposure to a single ticker
```sql
-- Direct holdings
SELECT 'direct' AS source, h.account_id, h.market_value AS exposure
FROM holdings h
WHERE h.user_id = $1 AND h.month = '2026-05' AND h.symbol = 'GOOG'

UNION ALL

-- Indirect via funds
SELECT 'indirect' AS source, h.account_id,
       h.market_value * fc.pct AS exposure
FROM holdings h
JOIN fund_constituents fc ON fc.fund_ticker = h.symbol
WHERE h.user_id = $1 AND h.month = '2026-05'
  AND fc.constituent_ticker = 'GOOG';
```

---

## Transactions

### Upsert pattern — pending to posted transition
```sql
INSERT INTO transactions (id, account_id, user_id, date, amount, name, merchant_name, pending)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (id) DO UPDATE SET
  pending       = EXCLUDED.pending,
  amount        = EXCLUDED.amount,
  name          = EXCLUDED.name,
  merchant_name = EXCLUDED.merchant_name;
```

### Soft-delete Plaid-removed transactions
```sql
UPDATE transactions
SET removed_at = now()
WHERE id = ANY($1) AND user_id = $2;
```

### Recent transactions for a user (excludes soft-deleted)
```sql
SELECT t.*, a.name AS account_name
FROM transactions t
JOIN accounts a ON a.id = t.account_id
WHERE t.user_id = $1 AND t.removed_at IS NULL
ORDER BY t.date DESC
LIMIT 100;
```

---

## Holdings Snapshot Upsert

### Write current month's holdings (append-only, never overwrites past months)
```sql
INSERT INTO holdings (id, account_id, user_id, month, symbol, description,
                      quantity, price, market_value, cost_basis, currency)
VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (account_id, month, symbol) DO UPDATE SET
  description  = EXCLUDED.description,
  quantity     = EXCLUDED.quantity,
  price        = EXCLUDED.price,
  market_value = EXCLUDED.market_value,
  cost_basis   = EXCLUDED.cost_basis;
```
