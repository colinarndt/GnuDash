import { NextResponse } from "next/server";
import { getAllPrices, upsertManyPrices } from "@/lib/prices/storage";
import { fetchMonthlyPrices, RateLimitError } from "@/lib/prices/alphavantage";
import type { PriceCache } from "@/lib/prices/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SymbolRequest {
  symbol: string;
  /** Earliest YYYY-MM we need price data for (from transaction history). */
  fromMonth: string;
}

/** One month before the current month — AV's monthly series lags by one month mid-cycle. */
function lastCompleteMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

/** True if any month in [fromMonth, toMonth] is absent from cached prices. */
function hasGap(
  cached: Record<string, number>,
  fromMonth: string,
  toMonth: string
): boolean {
  let [yr, mo] = fromMonth.split("-").map(Number);
  const [endYr, endMo] = toMonth.split("-").map(Number);
  while (yr < endYr || (yr === endYr && mo <= endMo)) {
    if (cached[`${yr}-${String(mo).padStart(2, "0")}`] == null) return true;
    mo++;
    if (mo > 12) { mo = 1; yr++; }
  }
  return false;
}

/**
 * POST /api/portfolio/prices
 * Body: { symbols: Array<{ symbol: string; fromMonth: string }> }
 *
 * For each symbol, checks the local price cache for gaps between fromMonth and
 * last complete month. Fetches from Alpha Vantage (serialised, 12.5 s apart)
 * for any symbol with gaps, then persists and returns the full updated cache.
 */
export async function POST(request: Request) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ALPHA_VANTAGE_API_KEY not configured" },
      { status: 500 }
    );
  }

  const body = (await request.json()) as { symbols: SymbolRequest[] };
  const symbols: SymbolRequest[] = Array.isArray(body.symbols) ? body.symbols : [];

  const ceiling = lastCompleteMonth();
  const cache = await getAllPrices();

  const toFetch = symbols.filter(({ symbol, fromMonth }) =>
    hasGap(cache[symbol] ?? {}, fromMonth, ceiling)
  );

  const updates: PriceCache = {};
  const errors: Record<string, string> = {};

  for (let i = 0; i < toFetch.length; i++) {
    const { symbol } = toFetch[i];
    // Honour the 5 req/min free-tier limit with a 12.5 s gap between calls.
    if (i > 0) await new Promise<void>((r) => setTimeout(r, 12_500));
    try {
      const prices = await fetchMonthlyPrices(symbol, apiKey);
      updates[symbol] = prices;
      // Update in-memory view so subsequent gap checks in this same request see it.
      cache[symbol] = { ...cache[symbol], ...prices };
    } catch (err) {
      errors[symbol] = (err as Error).message;
      // Stop immediately on rate limit — no point trying more symbols today.
      if (err instanceof RateLimitError) break;
    }
  }

  if (Object.keys(updates).length > 0) {
    await upsertManyPrices(updates);
  }

  return NextResponse.json({
    prices: cache,
    fetched: Object.keys(updates),
    errors,
  });
}

/** GET /api/portfolio/prices — return the full local cache without any AV calls. */
export async function GET() {
  return NextResponse.json({ prices: await getAllPrices() });
}
