import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/snaptrade/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Trigger a full refresh then redirect to the connections page
  try {
    await fetch(`${getAppUrl()}/api/snaptrade/refresh`, { method: "POST" });
  } catch { /* best-effort */ }
  return NextResponse.redirect(`${getAppUrl()}/connections`);
}
