import { NextResponse } from "next/server";
import { claudeParsePdf } from "@/lib/anthropic/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface DetectedHolding {
  ticker: string;
  description: string | null;
  shares: number;
  price: number | null;
  marketValue: number | null;
  costBasis: number | null;
}

export interface DetectedAccount {
  institutionName: string;
  accountName: string;
  accountNumber: string | null;
  accountType: string | null;
  holdings: DetectedHolding[];
  inferenceNotes: string[];
}

export interface ParseResult {
  accounts: DetectedAccount[];
}

const SYSTEM_PROMPT = `You are a financial document parser. Extract brokerage account holdings from the provided statement.

Return ONLY valid JSON matching this exact schema — no explanation, no markdown fences:
{
  "accounts": [
    {
      "institutionName": "string — name of the brokerage (e.g. Fidelity, Schwab, Vanguard)",
      "accountName": "string — account label from the statement (e.g. 'Individual Brokerage', 'Roth IRA')",
      "accountNumber": "string or null — last 4 digits only, null if not found",
      "accountType": "one of: roth_ira | traditional_ira | roth_401k | traditional_401k | 403b | 457b | sep_ira | solo_401k | hsa | 529 | taxable | other | null",
      "inferenceNotes": ["array of plain-English strings explaining any logical leaps made — e.g. 'Cost basis inferred from total contributions of $12,450 shown on page 3.' Leave empty if everything was stated explicitly."],
      "holdings": [
        {
          "ticker": "string — stock/ETF/fund ticker symbol, uppercase",
          "description": "string or null — full security name",
          "shares": number,
          "price": number or null — price per share,
          "marketValue": number or null — total market value,
          "costBasis": number or null — total cost basis
        }
      ]
    }
  ]
}

Rules:
- One entry per account. A statement may contain multiple accounts — include all of them.
- Skip money market sweep funds and cash positions unless they are the only holding.
- All numeric values must be plain numbers with no $ signs or commas.
- If a field cannot be determined, use null.
- accountType should be your best inference from the account name; null if truly ambiguous.
- costBasis: use the explicit cost basis if stated. If not, infer it from total contributions or employee/employer contributions shown anywhere in the statement (contributions = what was paid in, excluding gains). Do not use market value as cost basis.
- Annuities and other illiquid holdings with no tradeable ticker or per-share price: set shares to 0, price to null, and fill marketValue with the known market value. For ticker, synthesize a short uppercase identifier from the description (e.g. "ANNUITY", "FIXEDANN", "VARANN").`;

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const raw = await claudeParsePdf(
      SYSTEM_PROMPT,
      buffer,
      "Parse all accounts and holdings from this brokerage statement."
    );

    let parsed: ParseResult;
    try {
      parsed = JSON.parse(raw) as ParseResult;
    } catch {
      return NextResponse.json({ error: "Claude returned unparseable JSON.", raw }, { status: 502 });
    }

    if (!Array.isArray(parsed.accounts)) {
      return NextResponse.json({ error: "Unexpected response shape.", raw }, { status: 502 });
    }

    return NextResponse.json(parsed);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
