import type { Prisma } from "@prisma/client";
import { InventoryError } from "./inventory";

export const businessDate = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
export const requiresLateConfirmation = (created: Date, now = new Date()) => now.getTime() - created.getTime() > 24 * 60 * 60 * 1000;

// Call with the inventory advisory lock held so closing and returns cannot race.
export async function assertReturnPeriodOpen(tx: Prisma.TransactionClient, dates: string[]) {
  const lock = await tx.returnPeriodLock.findUnique({ where: { id: 1 } });
  const through = lock?.closed_through?.toISOString().slice(0, 10);
  if (through && dates.some(date => date <= through)) {
    throw new InventoryError(`Returns through ${through} are closed. Use a reviewed adjustment in an open period instead.`);
  }
}
