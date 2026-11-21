import { NextResponse } from "next/server";
import { getViews, createView, updateView, deleteView, setDefaultView } from "@/lib/investment-views/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ views: await getViews() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { name, selected_accounts } = (await request.json()) as {
      name: string;
      selected_accounts: string[];
    };
    if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
    const view = await createView(name.trim(), selected_accounts ?? []);
    return NextResponse.json({ view });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { id, name, selected_accounts, set_default } = (await request.json()) as {
      id: string | null;
      name?: string;
      selected_accounts?: string[];
      set_default?: boolean;
    };
    // set_default: id == null clears the default; otherwise marks that view as default.
    if (set_default !== undefined) {
      const views = await setDefaultView(set_default ? id : null);
      return NextResponse.json({ views });
    }
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const view = await updateView(id, {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(selected_accounts !== undefined ? { selectedAccounts: selected_accounts } : {}),
    });
    if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ view });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { id } = (await request.json()) as { id: string };
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const ok = await deleteView(id);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
