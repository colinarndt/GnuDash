export interface Improvement {
  id: string;
  description: string;
  date: string | null;
  cost: number;
}

export interface RealEstateProperty {
  id: string;
  nickname: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  estimatedValue: number | null;
  lastSynced: string | null;
  purchasePrice: number | null;
  purchaseDate: string | null;
  improvements: Improvement[];
  updatedAt: string;
  balanceHistory?: { date: string; value: number }[];
}

export function totalCostBasis(property: RealEstateProperty): number {
  return (property.purchasePrice ?? 0) +
    (property.improvements ?? []).reduce((s, i) => s + i.cost, 0);
}
