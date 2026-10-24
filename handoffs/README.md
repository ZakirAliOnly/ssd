# SSD module handoff — for developers and coding agents

This package explains how to recreate ten selected SSD modules in another software project with the same business logic. It includes implementation reference files, database definitions, module dependencies, worked calculations, acceptance checks and a ready-to-use coding-agent prompt.

## Start here

1. Read `IMPLEMENTATION-BRIEF.md` for the scope and exact module rules.
2. Read `ACCEPTANCE-CHECKS.md` for examples with expected outcomes.
3. Give `CODING-AGENT-PROMPT.md` and this entire folder to the implementing developer/agent.
4. Use `SOURCE-MANIFEST.json` to find each module's entry points; supporting source is under `reference-source/` with original paths preserved.
5. Follow `PORTING-NOTES.md` to distinguish current behavior from implementation weaknesses that should not be duplicated.

The ten modules are Workers, Expenses, Payment Methods, Activity Log, User Management, Footer Credit, Login, Cash Book, Supplier and Product.

## What this is

A business-logic and source reference handoff. The original uses Next.js 16.2.1, React 19.2.4, TypeScript, PostgreSQL, Prisma 6, Tailwind CSS 4, bcryptjs and jose. Another stack may reproduce the same domain behavior. The destination project owns its architecture, brand, deployment and database.

This is not an installable plugin or standalone starter app. The original modules are coupled through a shared `/api/db` route, permissions, bookkeeping and inventory. The supplied manifests describe the original application; they are not a minimal dependency list for the new project. No application files were changed to create this package.

## Scope boundaries

Customer invoices/parties, quotations, delivery challans, dashboards, reports and live WhatsApp automation are not requested as new modules. Some of their helpers/models are included because selected modules reference them. Treat them as context and document adapter boundaries rather than copying the entire old product. Supplier purchase invoices/POs are included because they are integral to the Supplier module. A minimal account/customer selector is needed by Cash Book; it does not imply implementing the full Parties module.

Do not connect this package to the original deployment, original database or original user accounts. No live records, credentials, `.env`, sessions, database dumps, Git metadata, node_modules or build outputs are included. Static source contains original branding/contact strings and references to original integration variable names; replace branding deliberately for the destination. Preserve the requested developer credit `Software developed by AddsMint.com` unless the owner changes it.

## Provenance and verification

The exact source commit and SHA-256 for every reference file are recorded in `SOURCE-MANIFEST.json`. Source files were copied from the current checkout, not reconstructed from memory. Included supporting context reflects that revision. All detected static local imports resolve within the reference subset. Dynamic imports/fixture loaders and omitted page routes may still require adapters; dependency closure is not a standalone build guarantee.

The original Update 027 build, type checking and seven invoice-document tests passed earlier in this session. That does not validate a future port. Validate the new implementation against the included acceptance checks in its own clean database. The package itself is checked for completeness, file hashes and archive integrity.
