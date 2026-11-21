import { NextResponse } from "next/server";
import { updatePortfolio, deletePortfolio } from "@/lib/manual-portfolios/storage";
import type { ManualHolding } from "@/lib/manual-portfolios/storage";
import { syncPriceHistory } from "@/lib/yahoo/prices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { name, holdings, account_type } = (await request.json()) as {
      name: string;
      holdings: ManualHolding[];
      account_type?: string;
    };
    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const portfolio = await updatePortfolio(id, { name: name.trim(), holdings: holdings ?? [], accountType: account_type || undefined });
    if (!portfolio) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const tickers = (holdings ?? []).filter((h) => h.fetchPriceOnline !== false).map((h) => h.ticker).filter(Boolean);
    if (tickers.length > 0) syncPriceHistory(tickers).catch(() => {});
    return NextResponse.json({ portfolio });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ok = await deletePortfolio(id);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
