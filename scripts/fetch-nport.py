#!/usr/bin/env python3
"""Fetch N-PORT holdings from SEC EDGAR and write to app/data/nport-cache.json.

Usage:
    pip install edgartools

    # Auto-detect tickers from fund-holdings-cache.json (recommended)
    python scripts/fetch-nport.py

    # Fetch specific tickers only
    python scripts/fetch-nport.py VWELX VTSAX MASKX

When run with no arguments the script reads every ticker from fund-holdings-cache.json
and tries each one. Non-fund tickers (stocks, crypto, etc.) will have no NPORT-P
filings on EDGAR and are silently skipped. Results are merged into the existing
nport-cache.json so re-running only refreshes the tickers you pass (or all of them).
"""

import sys
import json
import argparse
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict

SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "app" / "data"
OUT_FILE = DATA_DIR / "nport-cache.json"
HOLDINGS_CACHE = DATA_DIR / "fund-holdings-cache.json"

ISSUER_CAT_LABELS = {
    "UST": "US Treasuries",
    "USGA": "US Govt Agencies",
    "USO": "US Govt Sponsored",
    "CORP": "Corporate Bonds",
    "MUN": "Municipal Bonds",
    "FORGOV": "Foreign Govt Bonds",
    "ABS": "Asset-Backed Securities",
    "MBS": "Mortgage-Backed Securities",
    "OTH": "Other Fixed Income",
}


def fetch_fund(ticker: str):
    from edgar import Company

    try:
        company = Company(ticker)
        filings = company.get_filings(form="NPORT-P")
        if not filings or len(filings) == 0:
            print(f"  No NPORT-P filings found for {ticker}", file=sys.stderr)
            return None

        filing = filings[0]
        print(f"  Filing: {filing.filing_date}  period: {filing.period_of_report}")

        nport = filing.obj()
        if nport is None:
            print("  Could not parse N-PORT filing", file=sys.stderr)
            return None

        investments = nport.investments
        if investments is None:
            print("  No investments in filing", file=sys.stderr)
            return None

        records = list(investments)
        print(f"  {len(records)} investment records")

        equity = []
        bond_groups = defaultdict(float)
        stock_pct = bond_pct = cash_pct = other_pct = 0.0

        for rec in records:
            asset_cat = getattr(rec, "asset_category", "") or ""
            issuer_cat = getattr(rec, "issuer_category", "") or "OTH"
            pct_raw = getattr(rec, "pct_value", None)
            # pct_value is a percentage string (e.g. 5.58 means 5.58%)
            pct = float(pct_raw) / 100 if pct_raw is not None else 0.0
            name = getattr(rec, "name", "") or ""
            # Try top-level ticker first (edgartools may resolve it), then identifiers
            sym = getattr(rec, "ticker", None) or ""
            if not sym:
                identifiers = getattr(rec, "identifiers", None)
                sym = (getattr(identifiers, "ticker", None) if identifiers else None) or ""

            if pct <= 0:
                continue

            if asset_cat in ("EC", "EP"):
                equity.append({
                    "symbol": sym or name[:20] or "UNKNOWN",
                    "name": name,
                    "pct": pct,
                    "assetCategory": asset_cat,
                })
                stock_pct += pct
            elif asset_cat == "DBT":
                cat = issuer_cat or "OTH"
                bond_groups[cat] += pct
                bond_pct += pct
            elif asset_cat in ("STIV", "RF"):
                cash_pct += pct
            else:
                other_pct += pct

        equity.sort(key=lambda h: h["pct"], reverse=True)
        equity = equity[:500]

        bonds = [
            {
                "symbol": "",
                "name": ISSUER_CAT_LABELS.get(cat, f"Bonds ({cat})"),
                "pct": pct,
                "assetCategory": "DBT",
                "issuerCategory": cat,
            }
            for cat, pct in sorted(bond_groups.items(), key=lambda x: -x[1])
            if pct > 0.0001
        ]

        all_holdings = equity + bonds
        total_mapped = sum(h["pct"] for h in all_holdings)

        return {
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
            "quoteType": "MUTUALFUND",
            "source": "nport",
            "holdings": all_holdings,
            "totalMapped": round(total_mapped, 6),
            "stockPct": round(stock_pct, 6),
            "bondPct": round(bond_pct, 6),
            "cashPct": round(cash_pct, 6),
            "otherPct": round(other_pct, 6),
        }

    except Exception as e:
        print(f"  Error: {e}", file=sys.stderr)
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch N-PORT holdings from SEC EDGAR")
    parser.add_argument("tickers", nargs="*", help="Fund tickers to fetch (default: all from fund-holdings-cache.json)")
    args = parser.parse_args()

    try:
        from edgar import set_identity
        set_identity("Colin Arndt colinfarndt@gmail.com")
    except ImportError:
        print("edgartools not installed. Run: pip install edgartools", file=sys.stderr)
        sys.exit(1)

    if args.tickers:
        tickers = [t.upper() for t in args.tickers]
    else:
        if not HOLDINGS_CACHE.exists():
            print(f"No tickers specified and {HOLDINGS_CACHE} not found.", file=sys.stderr)
            sys.exit(1)
        with open(HOLDINGS_CACHE) as f:
            tickers = list(json.load(f).keys())
        print(f"Auto-detected {len(tickers)} tickers from fund-holdings-cache.json: {', '.join(tickers)}\n")

    existing = {}
    if OUT_FILE.exists():
        with open(OUT_FILE) as f:
            existing = json.load(f)

    for ticker in tickers:
        print(f"\n{ticker}")
        result = fetch_fund(ticker)
        if result:
            existing[ticker] = result
            eq = sum(1 for h in result["holdings"] if h.get("assetCategory") in ("EC", "EP"))
            bd = sum(1 for h in result["holdings"] if h.get("assetCategory") == "DBT")
            print(f"  -> {eq} equity holdings, {bd} bond groups, totalMapped={result['totalMapped']:.1%}")
        else:
            print(f"  -> FAILED — not written to cache")

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w") as f:
        json.dump(existing, f, indent=2)
    print(f"\nWrote {OUT_FILE}")


if __name__ == "__main__":
    main()
