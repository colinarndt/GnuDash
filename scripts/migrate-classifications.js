#!/usr/bin/env node
/**
 * One-time migration: merges the hardcoded STATIC_CLASSIFICATIONS from
 * index.ts into app/data/ticker-classifications.json.
 * User entries already in the file take precedence over static ones.
 * Safe to re-run — it is idempotent.
 */

const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "../app/data/ticker-classifications.json");

function e(assetClass, region, classDetailed, sector) {
  return [{ weight: 1, assetClass, region, classDetailed, sector }];
}

const STATIC = {
  // Broad US Equity
  SPY:    e("Equity", "Domestic", "US Large Cap",    "Diversified"),
  VOO:    e("Equity", "Domestic", "US Large Cap",    "Diversified"),
  IVV:    e("Equity", "Domestic", "US Large Cap",    "Diversified"),
  VFIAX:  e("Equity", "Domestic", "US Large Cap",    "Diversified"),
  FXAIX:  e("Equity", "Domestic", "US Large Cap",    "Diversified"),
  VTI:    e("Equity", "Domestic", "US Total Market", "Diversified"),
  VTSAX:  e("Equity", "Domestic", "US Total Market", "Diversified"),
  FZROX:  e("Equity", "Domestic", "US Total Market", "Diversified"),
  SCHB:   e("Equity", "Domestic", "US Total Market", "Diversified"),
  ITOT:   e("Equity", "Domestic", "US Total Market", "Diversified"),
  VO:     e("Equity", "Domestic", "US Mid Cap",      "Diversified"),
  IJH:    e("Equity", "Domestic", "US Mid Cap",      "Diversified"),
  MASKX:  e("Equity", "Domestic", "US Small Cap",    "Diversified"),
  IWM:    e("Equity", "Domestic", "US Small Cap",    "Diversified"),
  VBR:    e("Equity", "Domestic", "US Small Cap",    "Diversified"),
  VB:     e("Equity", "Domestic", "US Small Cap",    "Diversified"),
  IJR:    e("Equity", "Domestic", "US Small Cap",    "Diversified"),
  // Sector ETFs
  QQQ:    e("Equity", "Domestic", "US Large Cap", "Technology"),
  VGT:    e("Equity", "Domestic", "US Large Cap", "Technology"),
  XLK:    e("Equity", "Domestic", "US Large Cap", "Technology"),
  SCHG:   e("Equity", "Domestic", "US Large Cap", "Technology"),
  XLF:    e("Equity", "Domestic", "US Large Cap", "Financials"),
  XLV:    e("Equity", "Domestic", "US Large Cap", "Healthcare"),
  XLE:    e("Equity", "Domestic", "US Large Cap", "Energy"),
  XLI:    e("Equity", "Domestic", "US Large Cap", "Industrials"),
  XLP:    e("Equity", "Domestic", "US Large Cap", "Consumer Staples"),
  XLY:    e("Equity", "Domestic", "US Large Cap", "Consumer Discretionary"),
  XLB:    e("Equity", "Domestic", "US Large Cap", "Materials"),
  XLU:    e("Equity", "Domestic", "US Large Cap", "Utilities"),
  // US Large Cap stocks
  AAPL:   e("Equity", "Domestic", "US Large Cap", "Technology"),
  MSFT:   e("Equity", "Domestic", "US Large Cap", "Technology"),
  NVDA:   e("Equity", "Domestic", "US Large Cap", "Technology"),
  AMD:    e("Equity", "Domestic", "US Large Cap", "Technology"),
  AVGO:   e("Equity", "Domestic", "US Large Cap", "Technology"),
  ADBE:   e("Equity", "Domestic", "US Large Cap", "Technology"),
  ORCL:   e("Equity", "Domestic", "US Large Cap", "Technology"),
  CRM:    e("Equity", "Domestic", "US Large Cap", "Technology"),
  AMZN:   e("Equity", "Domestic", "US Large Cap", "Consumer Discretionary"),
  TSLA:   e("Equity", "Domestic", "US Large Cap", "Consumer Discretionary"),
  HD:     e("Equity", "Domestic", "US Large Cap", "Consumer Discretionary"),
  GOOGL:  e("Equity", "Domestic", "US Large Cap", "Communication Services"),
  GOOG:   e("Equity", "Domestic", "US Large Cap", "Communication Services"),
  META:   e("Equity", "Domestic", "US Large Cap", "Communication Services"),
  NFLX:   e("Equity", "Domestic", "US Large Cap", "Communication Services"),
  JPM:    e("Equity", "Domestic", "US Large Cap", "Financials"),
  BAC:    e("Equity", "Domestic", "US Large Cap", "Financials"),
  V:      e("Equity", "Domestic", "US Large Cap", "Financials"),
  MA:     e("Equity", "Domestic", "US Large Cap", "Financials"),
  "BRK.B":e("Equity", "Domestic", "US Large Cap", "Financials"),
  LLY:    e("Equity", "Domestic", "US Large Cap", "Healthcare"),
  JNJ:    e("Equity", "Domestic", "US Large Cap", "Healthcare"),
  UNH:    e("Equity", "Domestic", "US Large Cap", "Healthcare"),
  MRK:    e("Equity", "Domestic", "US Large Cap", "Healthcare"),
  ABBV:   e("Equity", "Domestic", "US Large Cap", "Healthcare"),
  TMO:    e("Equity", "Domestic", "US Large Cap", "Healthcare"),
  XOM:    e("Equity", "Domestic", "US Large Cap", "Energy"),
  CVX:    e("Equity", "Domestic", "US Large Cap", "Energy"),
  WMT:    e("Equity", "Domestic", "US Large Cap", "Consumer Staples"),
  COST:   e("Equity", "Domestic", "US Large Cap", "Consumer Staples"),
  PG:     e("Equity", "Domestic", "US Large Cap", "Consumer Staples"),
  // International Equity
  VEA:    e("Equity", "International", "Intl Developed",  "Diversified"),
  EFA:    e("Equity", "International", "Intl Developed",  "Diversified"),
  SCHF:   e("Equity", "International", "Intl Developed",  "Diversified"),
  VWO:    e("Equity", "International", "Emerging Markets","Diversified"),
  EEM:    e("Equity", "International", "Emerging Markets","Diversified"),
  IEMG:   e("Equity", "International", "Emerging Markets","Diversified"),
  VXUS:   e("Equity", "International", "Intl (Broad)",    "Diversified"),
  IXUS:   e("Equity", "International", "Intl (Broad)",    "Diversified"),
  VT:     e("Equity", "Global",        "Global Equity",   "Diversified"),
  ACWI:   e("Equity", "Global",        "Global Equity",   "Diversified"),
  // Real Estate
  VNQ:    e("Real Estate", "Domestic", "US REITs", "Real Estate"),
  SCHH:   e("Real Estate", "Domestic", "US REITs", "Real Estate"),
  // Fixed Income
  BND:    e("Fixed Income", "Domestic",      "US Bonds",         "Diversified"),
  AGG:    e("Fixed Income", "Domestic",      "US Bonds",         "Diversified"),
  SCHZ:   e("Fixed Income", "Domestic",      "US Bonds",         "Diversified"),
  VBTLX:  e("Fixed Income", "Domestic",      "US Bonds",         "Diversified"),
  FXNAX:  e("Fixed Income", "Domestic",      "US Bonds",         "Diversified"),
  VGSH:   e("Fixed Income", "Domestic",      "Short-Term Bonds", "Diversified"),
  VGIT:   e("Fixed Income", "Domestic",      "Interm Bonds",     "Diversified"),
  VGLT:   e("Fixed Income", "Domestic",      "Long-Term Bonds",  "Diversified"),
  VTIP:   e("Fixed Income", "Domestic",      "TIPS",             "Diversified"),
  TIP:    e("Fixed Income", "Domestic",      "TIPS",             "Diversified"),
  BNDX:   e("Fixed Income", "International", "Intl Bonds",       "Diversified"),
  // Cash / Money Market
  SPAXX:  e("Cash", "Domestic", "Money Market", "Diversified"),
  FDRXX:  e("Cash", "Domestic", "Money Market", "Diversified"),
  SPRXX:  e("Cash", "Domestic", "Money Market", "Diversified"),
  VMFXX:  e("Cash", "Domestic", "Money Market", "Diversified"),
  VMMXX:  e("Cash", "Domestic", "Money Market", "Diversified"),
  SWVXX:  e("Cash", "Domestic", "Money Market", "Diversified"),
  FDLXX:  e("Cash", "Domestic", "Money Market", "Diversified"),
  // Crypto ETFs
  FBTC:   e("Crypto", "Global", "Bitcoin ETF",  "Crypto"),
  IBIT:   e("Crypto", "Global", "Bitcoin ETF",  "Crypto"),
  GBTC:   e("Crypto", "Global", "Bitcoin ETF",  "Crypto"),
  FETH:   e("Crypto", "Global", "Ethereum ETF", "Crypto"),
  ETHA:   e("Crypto", "Global", "Ethereum ETF", "Crypto"),
  ETHW:   e("Crypto", "Global", "Ethereum ETF", "Crypto"),
  // Alternatives
  IAU:    e("Alternatives", "Global", "Gold",        "Materials"),
  GLD:    e("Alternatives", "Global", "Gold",        "Materials"),
  SGOL:   e("Alternatives", "Global", "Gold",        "Materials"),
  SLV:    e("Alternatives", "Global", "Commodities", "Materials"),
  DJP:    e("Alternatives", "Global", "Commodities", "Materials"),
};

const existing = JSON.parse(fs.readFileSync(OUT, "utf-8"));
// Static is the base; user entries win on conflict
const merged = { ...STATIC, ...existing };
fs.writeFileSync(OUT, JSON.stringify(merged, null, 2));
console.log(`Written ${Object.keys(merged).length} entries to ${OUT}`);
