/** Policy decisions are separate from transport so they can be tested without sending. */
export const WHATSAPP_EVENTS = ["invoice", "payment_received", "supplier_payment"] as const;
export type WhatsAppEvent = typeof WHATSAPP_EVENTS[number];
export const MIN_SEND_DELAY_SECONDS = 10;
export const DEFAULT_SEND_DELAY_SECONDS = 15;
export const MAX_ATTEMPTS = 5;

export function normalizeWhatsAppPhone(raw: string): string | null {
  const digits = raw.replace(/[\s()+.-]/g, "");
  const value = /^03\d{9}$/.test(digits) ? `92${digits.slice(1)}` : digits.replace(/^00/, "");
  return /^[1-9]\d{7,14}$/.test(value) ? value : null;
}

export function retryDelaySeconds(attempt: number, retryAfter = 0): number {
  return Math.max(60 * 2 ** Math.max(0, attempt - 1), Math.min(Math.max(0, retryAfter), 86400));
}

export function consentKeyword(text: string): "stop" | "start" | null {
  const word = text.trim().toLowerCase();
  if (["stop", "unsubscribe", "cancel", "end", "quit"].includes(word)) return "stop";
  if (["start", "subscribe"].includes(word)) return "start";
  return null;
}

// These old connection resets were not recipient opt-outs. Keep existing
// installations usable without rewriting history or requiring a migration.
export const LEGACY_WHATSAPP_RESETS = [
  "Linked account changed",
  "WhatsApp account disconnected",
  "Transport changed; consent must be recorded again",
] as const;

export function isWhatsAppRecipientBlocked(contact?: {
  opted_out_at?: unknown; consent_source?: string | null;
} | null): boolean {
  return !!contact?.opted_out_at && !LEGACY_WHATSAPP_RESETS.some(source => source === contact.consent_source);
}
