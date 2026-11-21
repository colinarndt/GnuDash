const BASE_URL = "https://api.anthropic.com/v1";
const MODEL = "claude-sonnet-4-6";

type UserContent =
  | { type: "text"; text: string }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
}

async function request(body: Record<string, unknown>): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");

  const res = await fetch(`${BASE_URL}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as AnthropicResponse;
  const text = data.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("No text content in Anthropic response");
  return text;
}

/** Send a PDF (as a Buffer or base64 string) plus a prompt; returns the text response. */
export async function claudeParsePdf(
  system: string,
  pdf: Buffer | string,
  prompt: string
): Promise<string> {
  const data = typeof pdf === "string" ? pdf : pdf.toString("base64");

  const content: UserContent[] = [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
    { type: "text", text: prompt },
  ];

  const raw = await request({
    model: MODEL,
    max_tokens: 4096,
    // Cache the system prompt — it's large and constant across calls
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
  });

  // Strip markdown code fences if the model wraps the JSON
  return raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
}
