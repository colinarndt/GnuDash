import type { StoredTransaction } from "./storage";

// GnuCash CSV Transaction Importer format.
// Plaid convention: positive amount = debit (money out), negative = credit (money in).
export function transactionsToCsv(transactions: StoredTransaction[]): string {
  const rows = [["Date", "Description", "Notes", "Deposit", "Withdrawal"]];
  for (const t of transactions) {
    const deposit = t.amount < 0 ? Math.abs(t.amount).toFixed(2) : "";
    const withdrawal = t.amount > 0 ? t.amount.toFixed(2) : "";
    rows.push([
      t.date,
      csvEscape(t.merchantName ?? t.name),
      csvEscape(t.id),
      deposit,
      withdrawal,
    ]);
  }
  return rows.map((r) => r.join(",")).join("\r\n");
}

function csvEscape(s: string): string {
  return /[,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
