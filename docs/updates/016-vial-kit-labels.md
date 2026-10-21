# Update 016 - Rename Piece and Packet to Vial and Kit

Use Vial for Piece/Pcs and Kit for Packet throughout product packaging fields, invoice unit selectors, stock equivalents, printed documents, returns, reports and WhatsApp invoice text. New product forms default to Vial. Existing Piece/Pcs base-unit values are displayed as Vial without a database rewrite; custom base-unit names remain supported. Existing Kit base-unit values remain available when editing, rather than being reinterpreted.

All persisted `piece`/`packet` codes, conversion factors, pricing fields, quantities and historical invoice snapshots stay unchanged. Box support remains. No database migration or dependency changes are required.

This is separate from Update 015's page-loading work; keep the numbered changes separate when preparing PRs. Build using SSD Node 22 and restart only `ssd-app` after deployment, preserving `/home/deploy/ssd/.env`, the WhatsApp key/session and the working port 3000 routing. Leave other apps and shared services untouched.
