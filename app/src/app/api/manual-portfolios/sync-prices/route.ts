import { NextResponse } from "next/server";
import { getPortfolios } from "@/lib/manual-portfolios/storage";
import { syncPriceHistory } from "@/lib/yahoo/prices";
import { getAllPrices } from "@/lib/prices/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** YYYY-MM of the previous calendar month — Yahoo's latest complete month. */
function prevMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

/** True when a ticker has no cached data or its latest month is before last month. */
function isStale(cached: Record<string, number> | undefined): boolean {
  if (!cached || Object.keys(cached).length === 0) return true;
  const latest = Object.keys(cached).sort().at(-1)!;
  return latest < prevMonth();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { force?: boolean };
    const force = body.force === true;

    const portfolios = await getPortfolios();
    const tickers = [
      ...new Set(
        portfolios.flatMap((p) =>
          p.holdings.filter((h) => h.fetchPriceOnline !== false).map((h) => h.ticker).filter(Boolean)
        )
      ),
    ];

    if (tickers.length === 0) {
      return NextResponse.json({ ok: true, fetched: [], skipped: [] });
    }

    const cache = await getAllPrices();
    const stale = force ? tickers : tickers.filter((t) => isStale(cache[t]));

    if (stale.length === 0) {
      return NextResponse.json({ ok: true, fetched: [], skipped: tickers });
    }

    await syncPriceHistory(stale);
    return NextResponse.json({ ok: true, fetched: stale, skipped: tickers.filter((t) => !stale.includes(t)) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
