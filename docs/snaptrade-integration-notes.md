# SnapTrade Integration Notes

## API Tier Limitations (Personal / `PERS-` accounts)

The SnapTrade client ID uses a `PERS-` prefix, indicating a **Personal tier** account. This tier has meaningful endpoint restrictions that differ from paid tiers.

### Endpoints that return 410 Gone on Personal tier

| Endpoint | SDK method | Status |
|---|---|---|
| `GET /accounts/{id}/holdings` | `accountInformation.getUserHoldings` | 410 Gone |
| `GET /holdings` (bulk) | `accountInformation.getAllUserHoldings` | "This endpoint is no longer available for your account" |
| `GET /activities` | `transactionsAndReporting.getActivities` | 410 Gone |

### Endpoints that work on Personal tier

| Endpoint | SDK method | Notes |
|---|---|---|
| `GET /accounts/{id}/positions` | `accountInformation.getUserAccountPositions` | Returns position/holdings data per account |
| `GET /accounts/{id}/balances` | `accountInformation.getUserAccountBalance` | Returns balance array; look for `total_equity` field |
| `GET /authorizations` | `connections.listBrokerageAuthorizations` | Works fine |
| `GET /accounts` | `accountInformation.listUserAccounts` | Works fine |

### Consequence for the app

Because `getActivities` is unavailable, SnapTrade accounts cannot offer transaction history CSV downloads. The Download button for SnapTrade accounts was changed to **Holdings (CSV)** — a client-side snapshot export of current positions using `getUserAccountPositions` data.

---

## SnapTrade Balance Response Shape

`getUserAccountBalance` returns an **array** of balance objects. The total portfolio value is in the `total_equity` field, not a top-level property:

```json
[
  {
    "currency": { "code": "USD", ... },
    "cash": 2006.02,
    "buying_power": 2006.02
    // total_equity may or may not be present depending on broker
  }
]
```

Fallback: if no `total_equity` entry exists, sum `marketValue` across all positions.

---

## SnapTrade User Registration

- **1 user per Personal API key** — cannot register additional user IDs.
- If a user ID already exists, the API returns error code `1010`.
- Workaround: store the existing `userSecret` in `.env` as `SNAPTRADE_USER_SECRET`. The `/api/snaptrade/user` route checks for this env var and skips the registration API call entirely.
- User credentials live in `app/data/snaptrade-data.json` (gitignored).

---

## SnapTrade OAuth Portal Quirks

- The "Done" button on the connection success screen does nothing on Personal accounts — it does not fire the redirect URI.
- The "Exit" confirmation loops back to itself if the user tries to leave.
- **Workaround implemented**: open the portal in a `window.open` popup; poll `popup.closed` every 1 second; on close, trigger a refresh automatically. User just closes the popup window manually.

---

## Data Storage Architecture

Both integrations use **JSON files on disk** — no database. Files live in `app/data/` (gitignored).

| File | Contents |
|---|---|
| `app/data/plaid-items.json` | Plaid access tokens, account metadata, balances, transactions |
| `app/data/snaptrade-data.json` | SnapTrade user credentials, authorizations, holdings, transactions |

Storage is single-user and single-process. No locking — concurrent requests could theoretically race, but this is acceptable for a local personal-use app.

The `PLAID_DATA_DIR` env var overrides the data directory (used in Docker to point to a volume mount).

---

## Work Done This Session

### SnapTrade holdings/balances fix

Switched from the deprecated bulk holdings endpoints to per-account calls:
- `getUserAccountPositions` for position data
- `getUserAccountBalance` for balance data

Both are called per account during refresh and sync.

### Connections page UI overhaul

- **Info modal (ⓘ button)** replaces the trash icon on each connection card. Shows: service, connected date, last synced, connection-level display name, per-account display names, per-account type dropdowns, per-account hide/show toggles, and a delete connection button.
- **Auto-open modal** on new connection: after Plaid `onSuccess` or SnapTrade popup close, the app detects new entries and opens the info modal automatically so the user can label accounts immediately.
- **Collapsible holdings rows** on SnapTrade accounts: each sub-account has a `›` caret that expands an inline holdings table scoped to that account.
- **Account display names**: both connection-level (card title) and per-account names are user-editable and stored in the JSON files.
- **Account type labels**: user-selectable from a full dropdown (Roth IRA, Traditional IRA, Roth/Traditional 401(k), 403(b), 457(b), SEP-IRA, Solo 401(k), SIMPLE IRA, Pension, HSA, 529 Plan, Taxable Brokerage, Checking, Savings, Money Market, CD, Credit Card, Other).
- **Hidden accounts**: per-account hide toggle removes the account from the main view and excludes its balance from section totals.
- **Button labels**: Plaid download → "Transactions (CSV)"; SnapTrade download → "Holdings (CSV)" (client-side CSV generation, no server roundtrip).
- **Account number display**: always trimmed to last 4 digits via `last4()` helper regardless of what the broker returns.
- Date range pickers removed entirely.
- "Last synced" timestamp and "SnapTrade" badge removed from card headers (info visible in modal instead).

### Bug fix: sync overwrites user customizations

`upsertAuthorization` was spreading new API account data over the stored record, which would silently wipe `accountType`, `hidden`, and `displayName` values on every refresh. Fixed by merging accounts: new API data is applied but user-set fields are preserved from the existing record.

---

## Environment Variables

```
SNAPTRADE_CLIENT_ID=PERS-...        # Personal tier client ID
SNAPTRADE_CONSUMER_KEY=...          # Consumer key
SNAPTRADE_USER_ID=...               # Registered user ID (1 per key on Personal tier)
SNAPTRADE_USER_SECRET=...           # Stored secret — bypasses re-registration on startup
APP_URL=http://localhost:3000       # Used to construct the OAuth redirect URI
PLAID_DATA_DIR=...                  # Optional override for data file location
```
