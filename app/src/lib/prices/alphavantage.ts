const AV_BASE = "https://www.alphavantage.co/query";

interface MonthlyEntry {
  "5. adjusted close": string;
}

interface AVResponse {
  "Monthly Adjusted Time Series"?: Record<string, MonthlyEntry>;
  "Error Message"?: string;
  "Note"?: string;
  "Information"?: string;
}

/**
 * Fetch full adjusted monthly closing prices from Alpha Vantage.
 * Returns a map of "YYYY-MM" → adjusted close price.
 * Throws on rate limit or unknown symbol so callers can skip and continue.
 */
export async function fetchMonthlyPrices(
  symbol: string,
  apiKey: string
): Promise<Record<string, number>> {
  const url = `${AV_BASE}?function=TIME_SERIES_MONTHLY_ADJUSTED&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as AVResponse;

  if (data["Error Message"]) throw new Error(data["Error Message"]);
  if (data["Note"] || data["Information"])
    throw new RateLimitError("Alpha Vantage rate limit reached — try again later");

  const series = data["Monthly Adjusted Time Series"];
  if (!series) throw new Error("No data returned from Alpha Vantage");

  const result: Record<string, number> = {};
  for (const [date, entry] of Object.entries(series)) {
    const price = parseFloat(entry["5. adjusted close"]);
    if (!isNaN(price) && price > 0) result[date.slice(0, 7)] = price;
  }
  return result;
}

export class RateLimitError extends Error {}
