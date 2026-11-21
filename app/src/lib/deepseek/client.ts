const BASE_URL = "https://api.deepseek.com";

export interface DeepSeekMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function deepseekChat(messages: DeepSeekMessage[], jsonMode = false): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      ...(jsonMode && { response_format: { type: "json_object" } }),
    }),
  });
  if (!res.ok) {
    throw new Error(`DeepSeek API ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0].message.content;
}
