# TODO

## Hosting requirements

### N-PORT data refresh (monthly cron)
`scripts/fetch-nport.py` fetches SEC EDGAR N-PORT filings and writes fund holdings to
`app/data/nport-cache.json`. N-PORT filings are published ~30 days after month-end, so
this script must be scheduled to run **every 30 days** in the hosting environment.

Options:
- **Cron job** on the server (e.g. `0 6 1 * * python /app/scripts/fetch-nport.py VWELX VTSAX ...`)
- **GitHub Actions** scheduled workflow that commits the updated cache file
- **Hosted cron service** (e.g. Render cron job, Railway cron, EasyCron)

The script is idempotent — re-running it only refreshes the tickers you pass as arguments.
If a ticker fetch fails, the existing cached entry is preserved.
