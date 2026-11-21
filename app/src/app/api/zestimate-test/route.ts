import { NextResponse } from "next/server";
import { getZestimate } from "@/lib/zestimate/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/zestimate-test?address=9252+Ravenwing+Dr&city=Charlotte&state=NC&zip=28269
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address") ?? "9252 Ravenwing Dr";
  const city = searchParams.get("city") ?? "Charlotte";
  const state = searchParams.get("state") ?? "NC";
  const zip = searchParams.get("zip") ?? "28269";

  const result = await getZestimate(address, city, state, zip);
  return NextResponse.json({ address: `${address}, ${city}, ${state} ${zip}`, ...result });
}
