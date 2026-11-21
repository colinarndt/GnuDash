import { NextResponse } from "next/server";
import { classifyNewTickers } from "@/lib/classifications/auto-classify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { tickers } = (await request.json()) as { tickers: string[] };
    if (!Array.isArray(tickers)) {
      return NextResponse.json({ error: "tickers must be an array" }, { status: 400 });
    }
    await classifyNewTickers(tickers);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
