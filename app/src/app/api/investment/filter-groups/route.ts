import { NextResponse } from "next/server";
import {
  getFilterGroups,
  replaceFilterGroups,
  DEFAULT_FILTER_GROUPS,
  type FilterGroup,
} from "@/lib/investment-filter-groups/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ groups: await getFilterGroups(), defaults: DEFAULT_FILTER_GROUPS });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { groups } = (await request.json()) as { groups: FilterGroup[] };
    if (!Array.isArray(groups)) {
      return NextResponse.json({ error: "groups must be an array" }, { status: 400 });
    }
    for (const g of groups) {
      if (typeof g.label !== "string" || !g.label.trim()) {
        return NextResponse.json({ error: "every group needs a non-empty label" }, { status: 400 });
      }
      if (!Array.isArray(g.paths)) {
        return NextResponse.json({ error: `group "${g.label}" has invalid paths` }, { status: 400 });
      }
    }
    await replaceFilterGroups(groups);
    return NextResponse.json({ groups });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
