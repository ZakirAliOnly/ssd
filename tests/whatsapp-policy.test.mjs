import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWhatsAppPhone, consentKeyword, retryDelaySeconds } from "../lib/whatsappPolicy.ts";

test("numbers preserve country codes and normalize Pakistani local mobile numbers", () => {
  assert.equal(normalizeWhatsAppPhone("0300 1234567"), "923001234567");
  assert.equal(normalizeWhatsAppPhone("+44 7700 900123"), "447700900123");
  assert.equal(normalizeWhatsAppPhone("00923001234567"), "923001234567");
  assert.equal(normalizeWhatsAppPhone("123"), null);
  assert.equal(normalizeWhatsAppPhone("0300oops1234567"), null);
});

test("only explicit consent keywords change consent and backoff respects provider limits", () => {
  assert.equal(consentKeyword(" STOP "), "stop");
  assert.equal(consentKeyword("Start"), "start");
  assert.equal(consentKeyword("Hello, please send my invoice"), null);
  assert.equal(retryDelaySeconds(1), 60);
  assert.equal(retryDelaySeconds(3, 500), 500);
  assert.equal(retryDelaySeconds(3), 240);
});
