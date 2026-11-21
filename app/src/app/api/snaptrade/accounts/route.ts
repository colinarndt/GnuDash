import { NextResponse } from "next/server";
import { getSnapTradeClient } from "@/lib/snaptrade/client";
import { getSnapTradeUser, getAuthorizations, removeAuthorization, updateAuthorizationMeta } from "@/lib/snaptrade/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const authorizations = await getAuthorizations();
    return NextResponse.json({ authorizations });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { authorization_id, display_name, account_types, hidden_accounts, account_display_names } = (await request.json()) as {
      authorization_id: string;
      display_name?: string | null;
      account_types?: Record<string, string>;
      hidden_accounts?: Record<string, boolean>;
      account_display_names?: Record<string, string>;
    };
    if (!authorization_id) return NextResponse.json({ error: "Missing authorization_id" }, { status: 400 });
    await updateAuthorizationMeta(authorization_id, { displayName: display_name, accountTypes: account_types, hiddenAccounts: hidden_accounts, accountDisplayNames: account_display_names });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { authorization_id } = (await request.json()) as { authorization_id: string };
    if (!authorization_id) return NextResponse.json({ error: "Missing authorization_id" }, { status: 400 });

    const user = await getSnapTradeUser();
    if (user) {
      try {
        const client = getSnapTradeClient();
        await client.connections.removeBrokerageAuthorization({
          authorizationId: authorization_id,
          userId: user.userId,
          userSecret: user.userSecret,
        });
      } catch { /* remove locally even if remote fails */ }
    }

    await removeAuthorization(authorization_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
