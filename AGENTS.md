<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Numbered updates and production requests

Give each update its own number and keep unrelated updates out of its PR.
When the user says "production", prepare/push the numbered update, create its PR when GitHub access permits, and provide a concise Hostinger agent deployment prompt. If PR creation is blocked, state that clearly and provide the create-PR link.
The Hostinger VPS hosts multiple apps: deployment prompts must scope database backups, migrations and service changes to SSD in `/home/deploy/ssd`, preserve `.env`, and leave other apps and shared PostgreSQL/Nginx services untouched.

Production troubleshooting confirmed SSD's canonical app listener on port 3000; routing its public domain to legacy port 3012 caused stylesheet 404s. Preserve the working SSD-only Nginx mapping and verify the actual listener before any future proxy changes. WhatsApp API mutations behind Nginx require preserved Host and overwritten X-Forwarded-Proto headers; do not disable origin checks or regenerate a valid session encryption key to resolve authorization errors.
