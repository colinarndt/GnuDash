interface RentcastAvm {
  price?: number | null;
  priceRangeLow?: number | null;
  priceRangeHigh?: number | null;
}

export async function getPropertyEstimate(
  address: string,
  city: string,
  state: string,
  zip: string
): Promise<number | null> {
  const apiKey = process.env.RENTCAST_API_KEY;
  if (!apiKey) throw new Error("RENTCAST_API_KEY is not set");

  const fullAddress = `${address}, ${city}, ${state} ${zip}`;
  const params = new URLSearchParams({ address: fullAddress });

  const res = await fetch(`https://api.rentcast.io/v1/avm/value?${params}`, {
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string; error?: string };
    throw new Error(body.message ?? body.error ?? `Rentcast error ${res.status}`);
  }
  const data = (await res.json()) as RentcastAvm;
  return data?.price ?? null;
}
