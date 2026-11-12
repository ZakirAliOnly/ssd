# Update 038 — Correct invoice edit activity

Invoice edits previously produced no edit event. The quick-invoice mirror refresh
deleted and recreated its internal item rows through the generic API, producing
one misleading "Deleted quick invoice item" entry per line. The activity screen
also discarded ordinary update events.

Customer invoice saves now write one Invoice Edited audit event in the same
transaction as the header, items and stock update. It includes the canonical
invoice number, customer, updated amount and authenticated editor's ID/name/email.
Direct invoice header updates are audited too. Purchase invoice saves record
Purchase Invoice Edited with the purchase number and supplier. Original creator
fields remain unchanged; the edit event identifies the person who made the edit.

Internal quick-invoice item refreshes no longer create deletion audit events.
The activity screen hides existing quick_invoice_item deletion noise without
altering stored history. It displays update events with an Edits filter, edit
icon, document/party subtitle and editor details. True invoice deletions retain
their deletion events. Edit amounts are not counted again as new invoices.
Return reversals and period-change events retain their existing presentation.

Earlier edits did not save reliable invoice/editor metadata, so their old item
deletion rows are not relabelled as invented invoice-edit events.

Validation: regression tests reproduced missing edit events and false mirror
deletions before the fix. Tests cover canonical and direct-header edits,
authenticated editors distinct from original creators, rollback on rejected
edits, purchase edits, actual invoice deletion and activity presentation.

No database migration or dependency change. Deploy only SSD in /home/deploy/ssd,
preserving .env, local changes and the previous working build. Build with SSD's
existing Node environment and restart only its existing ssd-app process. Leave
other applications, shared PostgreSQL/Nginx services, WhatsApp keys/sessions and
the working port-3000 proxy mapping untouched.
