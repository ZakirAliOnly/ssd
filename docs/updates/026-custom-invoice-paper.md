# Update 026 — 8.5 × 6.5 inch invoice paper

The shared invoice layout previously used 8.5 × 7 inches, which did not match the requested 8.5 inch wide × 6.5 inch high sheets. Browser printing, downloaded PDFs, and measured pagination now use **215.9 × 165.1 mm**. Party invoice print buttons show the actual size instead of Half Legal. Sales, walk-in, purchase and return documents share the change.

The layout retains a 6 mm internal safety margin on each edge. Browser page margins remain zero to avoid adding a second margin around that inset. Reports, ledgers and delivery challans keep their existing sizes. No database or financial calculation changes are required.

## Validation

- Production build and TypeScript checking (`npx tsc --noEmit --incremental false`) passed.
- All 7 existing invoice document tests passed.
- Chromium fixture checks used the actual shared React template, compiled global CSS and pagination/PDF helper: a single-page invoice, 70-line invoice (5 pages), purchase (3 pages), return (3 pages), and long notes (5 pages). Sheets measured 816 × 624 CSS pixels, retained the 6 mm content inset, had no sheet overflow, and retained products and totals.
- Browser PDFs for all five fixtures and downloaded single/multipage invoice PDFs had the expected page counts and measured 612 × 468 PDF points (8.5 × 6.5 inches). Repeated preparation followed by PDF export retained the multipage result.
- Physical HP LaserJet P2015/M1132 output remains a printer-side check; no claim of hardware validation is made.

## Printer settings

On each printer driver, create/select custom paper **width 215.9 mm, height 165.1 mm**, and confirm the driver supports that size. Match the preview orientation to the physical sheet and feed direction; a rotated driver form may express the same sheet as 165.1 × 215.9 mm. Use one page per sheet, 100% / Actual size, no additional browser margins, and disable browser-generated headers and footers. Avoid Fit/Shrink scaling. Adjust the tray guides and print one test invoice. The application cannot override the driver's paper definition or hardware unprintable area.

If clipping persists with matching settings, check the driver paper orientation, tray/feed alignment and printable-area limits before reducing the 6 mm inset. These laser printers are not assumed to support borderless printing.
