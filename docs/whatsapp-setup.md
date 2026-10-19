# WhatsApp QR setup and automatic messages

The **WhatsApp Setup** header link is available to super administrators. One linked number belongs to this business installation and its database. Deploy separate installations for independent clients. On mobile, the header opens a navigation menu containing the permitted modules and settings.

This uses **Baileys** (`@whiskeysockets/baileys`, pinned to `7.0.0-rc14`), an unofficial WhatsApp WebSocket connection. The client scans a real QR code in WhatsApp → Linked devices → Link a device. No Chromium, Puppeteer, Meta app or API token is required. The pinned Baileys release is a release candidate; verify QR linking and a consenting test send on your deployment before enabling automation. Unofficial automation can violate WhatsApp's terms and result in account restrictions; delays cannot guarantee compliance or prevent bans.

## Automatic events and existing buttons

- Invoice Save / Save & Print queues the existing invoice text for parties and walk-in customers. Editing refreshes an existing notification only before its first submission. Reprinting does not queue duplicates. Editing while automation is paused cancels an unsent notification to avoid obsolete details.
- Receiving a party payment queues the existing receipt with its ledger-derived remaining balance.
- Paying a supplier, including a purchase invoice advance, queues the existing supplier payment receipt.
- Existing WhatsApp buttons retain their manual sending behavior and message content. When automation is enabled, payment save actions no longer open an additional WhatsApp tab.

Notifications commit in the same database transaction as their business record. Unique event keys prevent duplicate queue entries for a saved document. Automation applies to future transactions while enabled, not historical records. Messages contain the existing text summary, not PDF attachments.

## Server installation

Use a persistent Linux server with Node.js 22+ (24 recommended), PostgreSQL and a process supervisor. The Baileys worker cannot run as an ephemeral serverless function. It must have the same database as the Next.js application, outbound HTTPS/WebSocket access to WhatsApp Web and its assets (`*.whatsapp.com`, `*.whatsapp.net`, `*.fbcdn.net`), and encrypted session storage in PostgreSQL.

Stop any previous WhatsApp worker before upgrading. From the checkout, with the intended database configured:

```bash
npm ci
npm run db:upgrade:whatsapp
npm run db:generate
npm run build
```

The repeatable additive migrations v36–v38 create the WhatsApp tables, connection control columns and encrypted authentication store. Run them before starting the updated application. Existing deployments should use these migrations rather than schema push. The first v38 upgrade pauses automation, cancels unsent legacy messages, marks interrupted sends unknown and requires a new scan. Repeating it preserves the new session. Development did not migrate a production database.

Configure the worker's `.env` or process environment:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Same PostgreSQL database as the application |
| `WHATSAPP_AUTH_ENCRYPTION_KEY` | Required: 32 random bytes encoded as 64 hex characters; generate with `openssl rand -hex 32` and save securely in `.env` or your service environment |
| `WHATSAPP_PROXY_URL` | Optional HTTPS/WebSocket proxy URL; omit on normal VPS deployments |

Keep the encryption key stable across restarts and backed up securely with the database. Do not paste it into chat or logs. Changing or losing it requires disconnecting and scanning again. The worker refuses to start without a valid key.

Run these as separate supervised processes from the checkout:

```bash
npm run start
npm run whatsapp:worker
```

The worker command loads `.env`; supervisor-provided environment variables take precedence. Keep one worker per installation and use graceful termination during deployments. A database lease prevents a second active worker. Allow at least 45 seconds for graceful worker shutdown so an in-progress send and credential writes can finish; retain a short restart delay. The worker polls each second, renews its lease every five seconds and stops if it loses database ownership. Live processes do not survive cloud snapshots; restart both services.

Baileys credentials and Signal keys are encrypted with AES-256-GCM in the `whatsapp_auth` database table. Writes are transactional and fenced by worker ownership/generation; stale workers cannot overwrite a new session. Protect the encryption key and database backups, which also contain financial message text. The setup API requires an authenticated administrator and returns QR codes with private/no-store caching. Existing Chromium authentication folders are not imported; unlink the old device from the phone, stop its old service and scan a fresh Baileys QR. No browser packages or system Chromium removal is necessary, especially on a VPS shared with other apps.

## Connect and enable

1. Start the worker. Open **WhatsApp Setup** and choose **Connect / show QR code**.
2. Scan with the client's WhatsApp Linked devices screen. The page polls for refreshed QR codes and linked-number status. Expired QR codes are hidden.
3. Enable automatic sending and the desired invoice, party receipt and supplier payment events, then save settings. A newly linked number starts paused.
4. Save a new invoice or payment with a valid saved recipient WhatsApp number. It queues automatically; no separate recipient permission record or contact form is required by the app.

Recipient preferences are optional and collapsed by default. STOP/UNSUBSCRIBE/CANCEL/END/QUIT blocks further notifications and cancels pending work; START/SUBSCRIBE resumes future notifications. Administrators can also stop or resume a number. Ordinary inbound messages do not override a stop. Only send these transaction updates to recipients who expect them. Existing held notifications remain held until reviewed; enabling automation never bulk-sends historical records.

The encrypted session is restored from PostgreSQL after worker restart. If WhatsApp logs out or initialization fails, reconnect from the page. Disconnect pauses automation, cancels queued/held work and asks the worker to log out and erase its encrypted session. Disconnect immediately erases the encrypted credentials, including when the worker is offline. If the worker still has an active in-memory connection it also attempts remote logout. Always revoke the old linked device from the phone if it was offline or remote logout failed. Changing numbers preserves explicit recipient opt-outs and cancels pending work so old financial messages are not sent from a different account. Already submitted messages cannot be recalled.

## Queue behavior

Default spacing is **15 seconds**, configurable from **10 to 3,600 seconds**. These are application pacing values, not an official safe sending limit. Missing numbers, recipient opt-outs, unregistered recipients, deleted source records, messages older than seven days and excessive message length are held with a reason. Fix a held issue before retrying. Missing destinations must be corrected in the customer record and sent manually; an existing financial message's recipient is never guessed.

Failures before submission back off exponentially, up to five attempts. An interrupted or uncertain send becomes `unknown` and is never automatically retried, because WhatsApp might already have received it. Check the linked account's chat before sending manually. Stale in-progress jobs are also marked unknown after recovery.

`accepted` means Baileys returned a message identifier; `sent`, `delivered`, `read` and failures follow WhatsApp acknowledgements while the worker runs. These are not a guarantee that a person read the message. Older acknowledgements cannot downgrade later delivery states. Resuming a number does not release old held messages automatically.

## Validation

```bash
node --test tests/*.test.mjs
npm run test:whatsapp
npx tsc --noEmit --incremental false
npm run build
```

The integration suite requires local PostgreSQL, creates a random temporary schema, and drops it afterward. It mocks WhatsApp transport and never sends to real recipients. It covers transactional queuing, original receipt contents, deduplication, concurrent claims, default transaction sending, explicit opt-outs, pacing, failures, session ownership, stale QR/events and acknowledgements.

The actual Baileys worker generated a real QR in the development cloud with TLS verification enabled, encrypted its credentials, erased them on disconnect and shut down cleanly. No account was linked and no real messages were sent. Client scanning, linked-session restore and delivery acknowledgements still require verification on the deployment server with a consenting test recipient.

## Updating an existing linked deployment to Update 008

Pull the merged update, build the app with SSD Node 22, and restart only SSD's app and Baileys worker gracefully. The worker must restart because it loads sending rules at startup. Preserve the existing encryption key and database credentials; the linked session restores from PostgreSQL and normally does not need another scan. No database migration or dependency install is required. Maintain SSD's working Nginx upstream on port 3000 and leave other apps untouched.

Historical automatic "account disconnected/changed" preference resets no longer count as recipient opt-outs. Actual STOP messages and administrator-recorded opt-outs remain effective, including after reconnecting. No contact records are bulk-created or marked as affirmative consent. Previously held financial notifications are not automatically released.
