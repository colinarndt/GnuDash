import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set(["EQUITY", "ETF", "MUTUALFUND", "CRYPTOCURRENCY"]);

const TYPE_LABEL: Record<string, string> = {
  EQUITY: "Stock",
  ETF: "ETF",
  MUTUALFUND: "Fund",
  CRYPTOCURRENCY: "Crypto",
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  if (!q || q.length < 1) return NextResponse.json({ results: [] });

  try {
    const url =
      `https://query2.finance.yahoo.com/v1/finance/search` +
      `?q=${encodeURIComponent(q)}&newsCount=0&enableFuzzyQuery=false&quotesCount=8`;

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return NextResponse.json({ results: [] });

    const data = (await res.json()) as {
      quotes?: Array<{
        symbol?: string;
        shortname?: string;
        longname?: string;
        quoteType?: string;
      }>;
    };

    const results = (data.quotes ?? [])
      .filter((q) => q.symbol && ALLOWED_TYPES.has(q.quoteType ?? ""))
      .map((q) => ({
        symbol: q.symbol!,
        name: q.longname ?? q.shortname ?? q.symbol!,
        type: TYPE_LABEL[q.quoteType ?? ""] ?? q.quoteType ?? "",
      }));

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
