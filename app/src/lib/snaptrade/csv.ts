import type { SnapTradeTransaction } from "./storage";

const ACTION_MAP: Record<string, string> = {
  BUY: "Buy",
  SELL: "Sell",
  DIV: "Div",
  DIVIDEND: "Div",
  INTEREST: "IntInc",
  REINVEST: "ReinvDiv",
  SPLIT: "SplitShrs",
  TRANSFER: "Buy",
};

function normalizeAction(type: string): string {
  return ACTION_MAP[type.toUpperCase()] ?? type;
}

function fmt(n: number | null, decimals = 4): string {
  if (n == null) return "";
  return n.toFixed(decimals);
}

function fmtDate(date: string): string {
  // Ensure MM/DD/YYYY format for GnuCash
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

function escapeCsv(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function transactionsToCsv(transactions: SnapTradeTransaction[]): string {
  const headers = ["Date", "Action", "Symbol", "Description", "Quantity", "Price", "Amount", "Fee", "Currency"];
  const rows = transactions
    .filter((t) => t.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => [
      fmtDate(t.date),
      normalizeAction(t.type),
      t.symbol ?? "",
      escapeCsv(t.description ?? ""),
      fmt(t.quantity),
      fmt(t.price),
      fmt(t.amount, 2),
      fmt(t.fee, 2),
      t.currency,
    ]);
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}
