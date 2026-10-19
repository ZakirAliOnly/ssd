# Update 008 — Scan, enable, then send

Suggested PR title: `Update 008: Send transaction messages after connecting and enabling WhatsApp`

Previously, scanning WhatsApp and enabling automation still left new notifications blocked until an administrator recorded each recipient's permission separately. New invoice, party payment received and supplier payment notifications now queue for valid saved recipient numbers without that extra form. Automatic sending and the relevant event must be enabled, and the linked worker must be running.

Recipient preferences are optional and collapsed by default. Explicit STOP messages and administrator opt-outs still block sending; START or an administrator can resume future notifications. These preferences survive account changes and disconnects. Historical system-generated account/transport reset records are distinguished from actual recipient opt-outs without rewriting data or requiring a migration. No records are fabricated as affirmative consent.

Existing message text, spacing, duplicate prevention, worker ownership and uncertain-send handling remain. Old held notifications are not bulk-released. Missing or invalid recipient numbers still require correction. WhatsApp acceptance and delivery acknowledgements remain visible in the queue.

Validation: 38 WhatsApp checks, 136 regression tests, TypeScript, focused lint and production build passed. A browser check against the production Next.js build in a temporary database schema enabled automation, saved a paid walk-in invoice through the real HTTP endpoints and processed one queued notification with zero recipient records. Sending used a mock transport; no actual WhatsApp message was sent. Mobile width 375px had no horizontal overflow. Live delivery on the deployed linked account remains to be verified.

Deployment: preserve local changes, .env, the existing encryption key and linked-session database data. Pull merged main, build with SSD Node 22 and gracefully restart only ssd-app and ssd-whatsapp-worker. Allow at least 45 seconds for worker shutdown and retain its Node 22 command, working directory and restart delay. Both services must load the new rules. No migration or dependency changes are needed; the existing session normally restores without scanning again. Keep the working SSD Nginx upstream on port 3000 and other VPS apps untouched. Verify worker stability, linked-session restoration and a new transaction notification using an agreed test recipient; do not bulk-retry historical messages.
