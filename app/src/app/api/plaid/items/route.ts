import { NextResponse } from "next/server";
import { getItems, removeItem, updateItemMeta } from "@/lib/plaid/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await getItems();
    const safe = items.map(({ accessToken: _at, ...meta }) => ({
      ...meta,
      transactionCounts: Object.fromEntries(
        meta.accounts.map((a) => [
          a.accountId,
          meta.transactions.filter((t) => t.accountId === a.accountId).length,
        ])
      ),
      holdings: meta.holdings ?? {},
    }));
    return NextResponse.json({ items: safe });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { item_id, display_name, account_types, hidden_accounts, account_display_names } = (await request.json()) as {
      item_id: string;
      display_name?: string | null;
      account_types?: Record<string, string>;
      hidden_accounts?: Record<string, boolean>;
      account_display_names?: Record<string, string>;
    };
    if (!item_id) return NextResponse.json({ error: "Missing item_id" }, { status: 400 });
    await updateItemMeta(item_id, { displayName: display_name, accountTypes: account_types, hiddenAccounts: hidden_accounts, accountDisplayNames: account_display_names });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { item_id } = (await request.json()) as { item_id: string };
    if (!item_id) return NextResponse.json({ error: "Missing item_id" }, { status: 400 });
    await removeItem(item_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
