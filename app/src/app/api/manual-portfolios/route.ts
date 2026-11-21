import { NextResponse } from "next/server";
import { getPortfolios, createPortfolio } from "@/lib/manual-portfolios/storage";
import type { ManualHolding } from "@/lib/manual-portfolios/storage";
import { syncPriceHistory } from "@/lib/yahoo/prices";
import { getAllPrices } from "@/lib/prices/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function latestPrice(ticker: string, cache: Record<string, Record<string, number>>): number | null {
  const months = cache[ticker];
  if (!months) return null;
  const latest = Object.keys(months).sort().at(-1);
  return latest ? months[latest] : null;
}

export async function GET() {
  try {
    const [portfolios, priceCache] = await Promise.all([getPortfolios(), getAllPrices()]);
    const enriched = portfolios.map((p) => ({
      ...p,
      holdings: p.holdings.map((h) => ({
        ...h,
        price: h.fetchPriceOnline !== false ? (latestPrice(h.ticker, priceCache) ?? h.price) : h.price,
      })),
    }));
    return NextResponse.json({ portfolios: enriched });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { name, holdings, account_type } = (await request.json()) as {
      name: string;
      holdings: ManualHolding[];
      account_type?: string;
    };
    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const portfolio = await createPortfolio({ name: name.trim(), holdings: holdings ?? [], accountType: account_type || undefined });
    const tickers = (holdings ?? []).filter((h) => h.fetchPriceOnline !== false).map((h) => h.ticker).filter(Boolean);
    if (tickers.length > 0) syncPriceHistory(tickers).catch(() => {});
    return NextResponse.json({ portfolio });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
