interface CrumbCache {
  crumb: string;
  cookie: string;
  expiresAt: number;
}

let cache: CrumbCache | null = null;

export async function getYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  if (cache && Date.now() < cache.expiresAt) {
    return { crumb: cache.crumb, cookie: cache.cookie };
  }
  try {
    const consentRes = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(6000),
      redirect: "follow",
    });
    const rawCookie = consentRes.headers.get("set-cookie") ?? "";
    const cookieHeader = rawCookie
      .split(",")
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": "Mozilla/5.0", Cookie: cookieHeader },
      signal: AbortSignal.timeout(6000),
    });
    const crumb = await crumbRes.text();
    if (!crumb || crumb.startsWith("{")) return null;

    cache = { crumb, cookie: cookieHeader, expiresAt: Date.now() + 30 * 60 * 1000 };
    return { crumb, cookie: cache.cookie };
  } catch {
    return null;
  }
}
