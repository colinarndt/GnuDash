import { NextResponse } from "next/server";
import { getSnapTradeClient } from "@/lib/snaptrade/client";
import { getSnapTradeUser, saveSnapTradeUser } from "@/lib/snaptrade/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns existing user, seeds from env vars, or registers a new one
export async function POST() {
  const snapUserId = process.env.SNAPTRADE_USER_ID;
  const snapUserSecret = process.env.SNAPTRADE_USER_SECRET;
  if (!snapUserId) {
    return NextResponse.json({ error: "SNAPTRADE_USER_ID env var is required" }, { status: 503 });
  }
  try {
    let user = await getSnapTradeUser();
    if (user) return NextResponse.json(user);

    // If secret is provided in env, skip registration and store directly
    if (snapUserSecret) {
      await saveSnapTradeUser(snapUserId, snapUserSecret);
      return NextResponse.json({ userId: snapUserId, userSecret: snapUserSecret });
    }

    const client = getSnapTradeClient();
    const { data } = await client.authentication.registerSnapTradeUser({
      userId: snapUserId,
    });
    const userId = (data as any).userId as string;
    const userSecret = (data as any).userSecret as string;
    await saveSnapTradeUser(userId, userSecret);
    return NextResponse.json({ userId, userSecret });
  } catch (err: any) {
    const body = err?.response?.data ?? err?.responseBody;
    if (body?.code === "1010") {
      return NextResponse.json(
        { error: `User ID "${snapUserId}" is already registered. Set SNAPTRADE_USER_SECRET in .env with your existing secret to use it directly.` },
        { status: 409 }
      );
    }
    const message = body ? JSON.stringify(body) : err?.message;
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
