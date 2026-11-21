import { NextResponse } from "next/server";
import { getProperties, createProperty } from "@/lib/real-estate/storage";
import type { Improvement } from "@/lib/real-estate/storage";
import { getZestimate } from "@/lib/zestimate/client";
import { getUserClassifications, saveUserClassifications } from "@/lib/classifications/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const properties = await getProperties();
    return NextResponse.json({ properties });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { nickname, address, city, state, zip, purchasePrice, purchaseDate, improvements } = (await request.json()) as {
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
    if (!address?.trim()) return NextResponse.json({ error: "Address is required" }, { status: 400 });
    if (!city?.trim()) return NextResponse.json({ error: "City is required" }, { status: 400 });
    if (!state?.trim()) return NextResponse.json({ error: "State is required" }, { status: 400 });
    if (!zip?.trim()) return NextResponse.json({ error: "ZIP is required" }, { status: 400 });

    let estimatedValue: number | null = null;
    let lastSynced: string | null = null;
    let priceError: string | null = null;
    try {
      const { zestimate } = await getZestimate(address.trim(), city.trim(), state.trim(), zip.trim());
      estimatedValue = zestimate;
      if (estimatedValue != null) lastSynced = new Date().toISOString();
    } catch (err) {
      priceError = (err as Error).message;
    }

    const property = await createProperty({
      nickname: nickname.trim(),
      address: address.trim(),
      city: city.trim(),
      state: state.trim(),
      zip: zip.trim(),
      estimatedValue,
      lastSynced,
      purchasePrice: purchasePrice ?? null,
      purchaseDate: purchaseDate ?? null,
      improvements: improvements ?? [],
    });

    // Auto-classify the property's nickname so the allocation pie works
    const cls = await getUserClassifications();
    cls[property.nickname] = [{ weight: 1, assetClass: "Real Estate", region: "Domestic", classDetailed: "Direct Real Estate", sector: "Real Estate" }];
    await saveUserClassifications(cls);

    return NextResponse.json({ property, priceError });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
