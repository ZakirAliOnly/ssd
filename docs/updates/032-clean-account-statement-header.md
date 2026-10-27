# Update 032 - Remove email and sales-manager details from statement letterhead

Remove the email address and Ejaz Gill / Sales Manager line from the shared colorful A4 letterhead used by account statement print/PDF output. Retain the logo, business name, address, telephone, mobile numbers, colors and ledger content. Other documents using the same default A4 letterhead receive the same cleanup; compact invoice headers are unchanged.

No dependencies or database migration. Build using SSD Node 22 in `/home/deploy/ssd` and restart only `ssd-app`, preserving `.env`, the working port 3000 routing, other apps and shared services.
