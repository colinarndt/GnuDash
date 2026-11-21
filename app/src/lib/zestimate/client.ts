import { deepseekChat } from "@/lib/deepseek/client";

interface OrganicResult {
  snippet?: string;
  snippet_highlighted_words?: string[];
  source?: string;
}

interface SerpApiGoogleResponse {
  organic_results?: OrganicResult[];
  answer_box?: { answer?: string; snippet?: string };
  error?: string;
}

export interface ZestimateResult {
  zestimate: number | null;
  /** "regex" = parsed directly from snippet text; "ai" = extracted by DeepSeek */
  source: "regex" | "ai" | null;
}

function parsePrice(raw: string): number | null {
  const match = raw.match(/\$([0-9,]+)/);
  if (!match) return null;
  const n = parseInt(match[1].replace(/,/g, ""), 10);
  return isNaN(n) || n === 0 ? null : n;
}

/** Pull Zestimate from highlighted words or snippet text using regex. */
function extractFromSnippets(results: OrganicResult[]): number | null {
  for (const r of results) {
    // snippet_highlighted_words often contains "Zestimate · $267,700"
    for (const word of r.snippet_highlighted_words ?? []) {
      if (/zestimate/i.test(word)) {
        const price = parsePrice(word);
        if (price) return price;
      }
    }
    // Fallback: scan the snippet text for a Zestimate dollar amount
    const snippet = r.snippet ?? "";
    const match = snippet.match(/[Zz]estimate[^$]*\$([0-9,]+)/);
    if (match) {
      const n = parseInt(match[1].replace(/,/g, ""), 10);
      if (!isNaN(n) && n > 0) return n;
    }
  }
  return null;
}

async function searchGoogle(fullAddress: string): Promise<SerpApiGoogleResponse> {
  const key = process.env.SERP_API_KEY;
  if (!key) throw new Error("SERP_API_KEY is not set");
  const params = new URLSearchParams({
    engine: "google",
    q: `${fullAddress} zillow zestimate`,
    api_key: key,
  });
  const res = await fetch(`https://serpapi.com/search?${params}`, {
    signal: AbortSignal.timeout(15000),
  });
  return res.json() as Promise<SerpApiGoogleResponse>;
}

export async function getZestimate(
  address: string,
  city: string,
  state: string,
  zip: string
): Promise<ZestimateResult> {
  const fullAddress = `${address}, ${city}, ${state} ${zip}`;
  const data = await searchGoogle(fullAddress);

  if (data.error) throw new Error(`SerpAPI error: ${data.error}`);

  const organic = data.organic_results ?? [];

  // 1. Fast path: regex parse from snippets (no AI cost)
  const regexPrice = extractFromSnippets(organic);
  if (regexPrice) return { zestimate: regexPrice, source: "regex" };

  // 2. Slow path: pass all snippet text to DeepSeek
  const context = [
    data.answer_box?.snippet ?? "",
    data.answer_box?.answer ?? "",
    ...organic.slice(0, 5).map((r) => r.snippet ?? ""),
  ]
    .filter(Boolean)
    .join("\n");

  if (!context.trim()) return { zestimate: null, source: null };

  const raw = await deepseekChat(
    [
      {
        role: "system",
        content:
          'Extract the Zillow Zestimate as a plain integer with no symbols. Return {"zestimate": <number>} or {"zestimate": null} if not found.',
      },
      {
        role: "user",
        content: `Address: ${fullAddress}\n\n${context.slice(0, 4000)}`,
      },
    ],
    true
  );

  try {
    const parsed = JSON.parse(raw) as { zestimate?: number | null };
    const price = parsed.zestimate ? parseInt(String(parsed.zestimate), 10) : null;
    return { zestimate: price && !isNaN(price) ? price : null, source: price ? "ai" : null };
  } catch {
    return { zestimate: null, source: null };
  }
}
