import { NextResponse } from "next/server";
import { getSnapTradeClient, getAppUrl } from "@/lib/snaptrade/client";
import { getSnapTradeUser } from "@/lib/snaptrade/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const user = await getSnapTradeUser();
    if (!user) return NextResponse.json({ error: "SnapTrade user not registered" }, { status: 400 });

    const client = getSnapTradeClient();
    const redirectUri = `${getAppUrl()}/api/snaptrade/callback`;

    const { data } = await client.authentication.loginSnapTradeUser({
      userId: user.userId,
      userSecret: user.userSecret,
      body: { redirectUri },
    });
    const redirectURL = (data as any).redirectURI as string;
    return NextResponse.json({ redirectURL });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
