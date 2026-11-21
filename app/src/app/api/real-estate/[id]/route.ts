import { NextResponse } from "next/server";
import { getProperties, updateProperty, deleteProperty } from "@/lib/real-estate/storage";
import type { Improvement } from "@/lib/real-estate/storage";
import { getZestimate } from "@/lib/zestimate/client";
import { getUserClassifications, saveUserClassifications } from "@/lib/classifications/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Refresh estimated value from Zestimate (via Google/SerpAPI)
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const properties = await getProperties();
    const property = properties.find((p) => p.id === id);
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let estimatedValue: number | null = null;
    try {
      const { zestimate } = await getZestimate(
        property.address,
        property.city,
        property.state,
        property.zip
      );
      estimatedValue = zestimate;
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const history = estimatedValue != null
      ? [...(property.balanceHistory ?? []).filter((e) => e.date !== today), { date: today, value: estimatedValue }]
      : property.balanceHistory;
    const updated = await updateProperty(id, {
      estimatedValue,
      lastSynced: new Date().toISOString(),
      balanceHistory: history,
    });
    return NextResponse.json({ property: updated });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// Edit property details
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const properties = await getProperties();
    const existing = properties.find((p) => p.id === id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { nickname, address, city, state, zip, purchasePrice, purchaseDate, improvements } =
      (await request.json()) as {
        nickname: string;
        address: string;
        city: string;
        state: string;
        zip: string;
        purchasePrice: number | null;
        purchaseDate: string | null;
        improvements: Improvement[];
      };

    if (!nickname?.trim()) return NextResponse.json({ error: "Nickname is required" }, { status: 400 });

    const updated = await updateProperty(id, {
      nickname: nickname.trim(),
      address: address.trim(),
      city: city.trim(),
      state: state.trim(),
      zip: zip.trim(),
      purchasePrice: purchasePrice ?? null,
      purchaseDate: purchaseDate ?? null,
      improvements: improvements ?? [],
    });

    // Keep classification in sync if nickname changed
    const cls = await getUserClassifications();
    if (existing.nickname !== nickname.trim()) {
      delete cls[existing.nickname];
    }
    cls[nickname.trim()] = [{ weight: 1, assetClass: "Real Estate", region: "Domestic", classDetailed: "Direct Real Estate", sector: "Real Estate" }];
    await saveUserClassifications(cls);

    return NextResponse.json({ property: updated });
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
    const ok = await deleteProperty(id);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
