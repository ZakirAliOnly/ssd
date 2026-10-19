# Update 005 — WhatsApp automation using Baileys

Add automatic invoice and receipt messages through WhiskeySockets Baileys. No Chromium or Puppeteer dependency is required. Keep the QR setup page, mobile navigation, original invoice/receipt text and manual buttons, consent checks and durable paced queue.

Baileys runs as a separate supervised ESM worker, with one database ownership lease per installation. Credentials and Signal keys are encrypted with AES-256-GCM in PostgreSQL; expired worker owners and old connection generations cannot overwrite them. The required WHATSAPP_AUTH_ENCRYPTION_KEY must be stable and backed up securely. A new migration v38 adds this store and requires a fresh scan when upgrading from the old transport. Financial tables are not modified by the migration.

Transient disconnections reconnect with bounded backoff. Revoked/invalid sessions require a fresh scan. Uncertain submissions are not retried automatically. Baileys 7.0.0-rc14 is pinned; it is an unofficial release candidate and delays do not guarantee compliance with WhatsApp terms.

Validation: 20 queue/policy/session checks and six encrypted auth-store/migration tests passed. An actual worker process generated a real QR, persisted encrypted credentials, erased them on disconnect, and shut down cleanly. Production build, TypeScript, focused lint and 136 regression checks passed on the latest main. No account was linked or real message sent. Deployment guide: docs/whatsapp-setup.md.

This PR includes the QR setup page, responsive header and transactional queue hooks. Update 003 is separate; the other developer’s product changes on main are preserved. See AGENTS.md for the numbered-update and production deployment workflow.
