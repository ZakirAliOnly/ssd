"use client";
import { useEffect, useRef } from "react";

/** Open the referenced role's ledger after its account list has loaded. */
export function useLedgerDeepLink<T extends { id: string }>(items: T[], open: (item: T) => Promise<void>) {
  const opened = useRef("");
  const handler = useRef(open);
  useEffect(() => { handler.current = open; }, [open]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("ledger");
    if (!id || opened.current === id) return;
    const item = items.find(row => row.id === id);
    if (item) { opened.current = id; void handler.current(item); }
  }, [items]);
}
