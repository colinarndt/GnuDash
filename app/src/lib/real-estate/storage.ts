import fs from "fs/promises";
import path from "path";
import type { RealEstateProperty } from "./types";

export type { Improvement, RealEstateProperty } from "./types";
export { totalCostBasis } from "./types";

const DATA_DIR = process.env.PLAID_DATA_DIR ?? path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "real-estate.json");

export async function getProperties(): Promise<RealEstateProperty[]> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE, "utf-8")) as RealEstateProperty[];
    return raw.map((p) => ({ ...p, improvements: p.improvements ?? [] }));
  } catch {
    return [];
  }
}

async function saveProperties(properties: RealEstateProperty[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(properties, null, 2), "utf-8");
}

export async function createProperty(
  data: Omit<RealEstateProperty, "id" | "updatedAt">
): Promise<RealEstateProperty> {
  const properties = await getProperties();
  const property: RealEstateProperty = {
    ...data,
    id: crypto.randomUUID(),
    updatedAt: new Date().toISOString(),
  };
  properties.push(property);
  await saveProperties(properties);
  return property;
}

export async function updateProperty(
  id: string,
  data: Partial<Omit<RealEstateProperty, "id">>
): Promise<RealEstateProperty | null> {
  const properties = await getProperties();
  const idx = properties.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  properties[idx] = { ...properties[idx], ...data, updatedAt: new Date().toISOString() };
  await saveProperties(properties);
  return properties[idx];
}

export async function deleteProperty(id: string): Promise<boolean> {
  const properties = await getProperties();
  const filtered = properties.filter((p) => p.id !== id);
  if (filtered.length === properties.length) return false;
  await saveProperties(filtered);
  return true;
}
