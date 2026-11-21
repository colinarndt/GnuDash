export type TickerAllocation = {
  weight: number;      // 0–1, all allocations for a ticker must sum to 1.0
  assetClass: string;
  region: string;
  classDetailed: string;
  sector: string;
};

export const ASSET_CLASSES = [
  "Equity", "Fixed Income", "Cash", "Crypto",
  "Real Estate", "Alternatives",
] as const;

export const REGIONS = ["Domestic", "International", "Global"] as const;

export const SECTORS = [
  "Technology", "Healthcare", "Financials",
  "Consumer Discretionary", "Consumer Staples",
  "Energy", "Utilities", "Materials", "Industrials",
  "Real Estate", "Communication Services",
  "Crypto", "Diversified",
] as const;

export const DETAILED_CLASSES = [
  "US Large Cap", "US Mid Cap", "US Small Cap", "US Total Market",
  "Intl Developed", "Emerging Markets", "Intl (Broad)", "Global Equity",
  "US Bonds", "Short-Term Bonds", "Interm Bonds", "Long-Term Bonds", "TIPS", "Intl Bonds",
  "Money Market",
  "Bitcoin ETF", "Ethereum ETF",
  "US REITs",
  "Gold", "Commodities",
] as const;

/**
 * Return the ticker's allocations from the merged table.
 * Returns [] when the ticker is not classified (caller should treat as "Unclassified").
 */
export function getClassification(
  ticker: string,
  merged: Record<string, TickerAllocation[]>
): TickerAllocation[] {
  return merged[ticker] ?? [];
}

export type GroupField = "assetClass" | "region" | "classDetailed" | "sector";
