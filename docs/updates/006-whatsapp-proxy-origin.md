# Update 006 — Allow administrator WhatsApp actions behind HTTPS Nginx

Suggested PR title: `Update 006: Fix WhatsApp connect behind HTTPS proxy`

A valid super administrator could read WhatsApp settings but received "Administrator access required" when connecting or saving. The mutation origin guard compared the browser's HTTPS public origin with Next.js's internal HTTP origin behind Nginx.

Validate the browser Origin against the preserved Host and overwritten X-Forwarded-Proto headers. Nginx must set these headers; X-Forwarded-Host is intentionally ignored. Foreign origins, malformed headers, cross-site requests, inactive accounts and sub-users remain rejected. Origin failures now receive a separate diagnostic instead of an incorrect administrator error.

Validation: production build, TypeScript, focused lint and 29 WhatsApp checks passed. Added coverage for HTTPS-proxied connect/settings updates, mismatched hosts/schemes/ports, forged forwarding headers, inactive accounts and sub-user restrictions. No account was linked or real messages sent.

Deployment: preserve .env and the stable WHATSAPP_AUTH_ENCRYPTION_KEY, build with SSD's Node 22 executable, and restart only ssd-app. No dependencies or database migration are needed. Leave the Baileys worker running. Public routing was confirmed on the VPS to require port 3000; the legacy port 3012 returned a 404 for the same stylesheet that port 3000 served successfully. Keep the working Nginx mapping and other VPS apps untouched. Check Connect / show QR code from the public HTTPS domain as an administrator.
