"use client";

import { useEffect } from "react";

export function PriceSync() {
  useEffect(() => {
    fetch("/api/manual-portfolios/sync-prices", { method: "POST" }).catch(() => {});
  }, []);
  return null;
}
