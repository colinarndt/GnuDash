import { NextResponse } from "next/server";
import { getUserClassifications, saveUserClassifications } from "@/lib/classifications/storage";
import type { TickerAllocation } from "@/lib/classifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getUserClassifications();
    return NextResponse.json({ classifications: user });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { classifications } = (await request.json()) as { classifications: Record<string, TickerAllocation[]> };
    if (!classifications || typeof classifications !== "object") {
      return NextResponse.json({ error: "Missing classifications" }, { status: 400 });
    }
    await saveUserClassifications(classifications);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
