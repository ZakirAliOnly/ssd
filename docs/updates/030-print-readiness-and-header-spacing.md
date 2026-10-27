# Update 030 - Recover stalled invoice printing and add A5 header spacing

Party invoice printing previously waited indefinitely for its live balance request and document fonts before registering cleanup. It also waited on an animation frame to commit the balance, which can pause in background tabs. The button could therefore remain busy before the browser print dialog opened.

Print/PDF balance preparation now times out after 15 seconds, suppresses late balance updates after cancellation, releases the busy state on failure and permits retry. A synchronous React commit makes the fresh balance available to the print template without waiting for an animation frame. A ref prevents duplicate print/PDF jobs during rapid clicks. Font readiness waits at most two seconds before using fallback fonts.

A5 sheets now have 15mm top padding (previously 10mm), retaining 10mm bottom and 4mm side padding. Pagination deducts the additional top space so rows and totals still fit. Source measurement, browser printing and PDF sheets use the same margins. The party print buttons now say A5 Print to match Update 029's existing physical page size.

No dependencies, database migration or financial calculation changes. Deploy from `/home/deploy/ssd` using SSD's Node 22 runtime, preserve `.env`, build and restart only `ssd-app`. Leave the port 3000 routing, other apps and shared services untouched.

Validation: three focused readiness tests and TypeScript passed. Focused ESLint reported no errors and one existing unused-state warning in Accounts. No production/browser print dialog verification was performed.
