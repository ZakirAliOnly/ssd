# Update 017 - Remove WhatsApp from SSD

Removes the setup page/navigation, all WhatsApp API routes, manual sending actions from invoices, parties, purchase invoices, quotations, worker payments and cashbook, transaction enqueue hooks, messaging helpers, worker code and dedicated tests. Removes Baileys, QR, logging and proxy dependencies used only by that feature, worker/test/setup scripts and environment examples. Payments now confirm their save without contacting a messaging service. PDF/print, stock and financial operations remain available.

Party contact fields are ordinary mobile-number fields. The repeatable retirement SQL copies a legacy WhatsApp number into an empty phone field and disables the retired connection. It never overwrites an existing phone number. Historical messaging tables, encrypted sessions and legacy schema/migration definitions are retained as inactive data for backup and recovery, with no runtime access paths. Existing environment secrets remain untouched. The standalone SSD-Design.html and older update documents are historical references, not production routes.

## Shared VPS deployment

1. Work only in `/home/deploy/ssd`. Preserve local edits and `.env`, record the old commit and supervisor definitions, and create/validate a private SSD-only database backup.
2. Before updating code, gracefully stop **only** `ssd-whatsapp-worker`, allowing at least 45 seconds for shutdown. Verify it is stopped, then remove that exact worker from the supervisor's saved startup configuration so it cannot send queued messages after a reboot. If PM2 manages it, delete only that named process and persist the intended process list. Never use `pm2 stop all`, restart the daemon, or change other apps.
3. Pull the merged Update 017, use SSD Node 22 and run `npm ci`, `npm run db:upgrade:retire-whatsapp`, `npm run db:generate`, and `npm run build`. Stop on errors. Never run schema push, destructive database cleanup or old WhatsApp setup migrations.
4. Restart only `ssd-app` using its existing supervisor definition. Leave other SSD/other-app services unchanged. Keep the working SSD Nginx upstream on port 3000; verify the actual listener and leave shared PostgreSQL/Nginx services untouched.
5. Verify the setup link and sending actions are gone, `/whatsapp-setup` and `/api/whatsapp/*` no longer expose the feature, contact numbers remain visible, and invoices/payment forms/printing still open. Do not create financial transactions just to verify deployment.

Deploy removal only after retiring the old worker: removing its source alone does not stop an already-running process. For rollback, keep the worker disabled until an operator explicitly decides whether messaging should resume.

## Verification

Route types regenerated and TypeScript passed after removing the routes. Focused lint passed for the affected screens and transaction endpoint after cleanup. Full build/browser/database testing was not rerun, following the request to limit testing. Production has not been changed.
