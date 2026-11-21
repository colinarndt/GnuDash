import { NextResponse } from "next/server";
import { getPlaidClient } from "@/lib/plaid/client";
import { Products, CountryCode } from "plaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const client = getPlaidClient();
    const res = await client.linkTokenCreate({
      user: { client_user_id: "gnudash-user" },
      client_name: "GnuDash",
      products: [Products.Transactions, Products.Investments],
      country_codes: [CountryCode.Us],
      language: "en",
    });
    return NextResponse.json({ link_token: res.data.link_token });
  } catch (err) {
    const plaidData = (err as any)?.response?.data;
    const message = plaidData?.error_message
      ? `${plaidData.error_code}: ${plaidData.error_message}`
      : (err as Error).message;
    const status = message.includes("env var") ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
