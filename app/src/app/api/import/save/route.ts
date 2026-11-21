import { NextResponse } from "next/server";
import { getPortfolios, createPortfolio, updatePortfolio } from "@/lib/manual-portfolios/storage";
import type { DetectedAccount } from "@/app/api/import/parse/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SaveRequest {
  accounts: DetectedAccount[];
  sourceFile: string;
}

export async function POST(request: Request) {
  try {
    const { accounts, sourceFile } = (await request.json()) as SaveRequest;

    if (!Array.isArray(accounts) || accounts.length === 0) {
      return NextResponse.json({ error: "No accounts provided" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const existing = await getPortfolios();

    // Sequential — createPortfolio/updatePortfolio each read-modify-write the JSON file,
    // so parallel execution causes last-write-wins data loss.
    const results = [];
    for (const acc of accounts) {
      const match = existing.find((p) =>
        acc.accountNumber && p.accountNumber
          ? p.accountNumber === acc.accountNumber && p.institutionName === acc.institutionName
          : p.institutionName === acc.institutionName && p.name === acc.accountName
      );

      const existingFlags: Record<string, boolean> = {};
      if (match) {
        for (const h of match.holdings) {
          existingFlags[h.ticker] = h.fetchPriceOnline !== false;
        }
      }

      const holdings = acc.holdings.map((h) => ({
        ticker: h.ticker,
        description: h.description,
        shares: h.shares,
        price: h.price,
        marketValue: h.marketValue ?? null,
        costBasis: h.costBasis,
        fetchPriceOnline: existingFlags[h.ticker] ?? (h.price != null),
      }));

      const data = {
        name: acc.accountName,
        holdings,
        institutionName: acc.institutionName,
        accountNumber: acc.accountNumber ?? undefined,
        accountType: acc.accountType ?? undefined,
        source: "file-import" as const,
        lastImported: now,
        sourceFile,
      };

      results.push(await (match ? updatePortfolio(match.id, data) : createPortfolio(data)));
    }

    return NextResponse.json({ portfolios: results });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
