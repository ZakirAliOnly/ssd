# UI Registry

### Product search

File: app/(dashboard)/products/page.tsx
Last updated: 2026-10-12

| Property | Class / token |
| --- | --- |
| Background | var(--gray-50) |
| Border | border-[1.5px] border-[var(--gray-200)] |
| Border radius | rounded-[9px] |
| Text — primary | text-[13px], var(--gray-900) |
| Text — secondary | var(--gray-800) |
| Spacing | pl-9 pr-10 py-2; toolbar px-5 py-3 |
| Hover state | hover:bg-[var(--blue-pale)] on clear button |
| Focus state | focus-visible:ring-2 focus-visible:ring-[var(--blue)] |
| Shadow | none |
| Accent usage | var(--blue-deeper) for empty-state action |

**Pattern notes:** Match the existing catalogue inputs. Use a leading Lucide Search icon, accessible input and clear-button names, full width on mobile, and a compact toolbar field on larger screens.

### Stock reports

File: components/StockReport.tsx and app/(dashboard)/reports/page.tsx
Last updated: 2026-10-13

| Property | Class / token |
| --- | --- |
| Background | bg-white; var(--gray-50) for totals and filter inputs |
| Border | border border-[var(--gray-100)]; filter border-[1.5px] var(--gray-200) |
| Border radius | rounded-[14px] report panel; rounded-[8px] category selector |
| Text — primary | existing DT table tokens; text-lg font-extrabold heading |
| Text — secondary | text-xs var(--gray-800) |
| Spacing | p-4 panel; DT.tdDense table cells |
| Focus state | focus-visible:outline-2 focus-visible:outline-[var(--blue)] |
| Shadow | var(--shadow-sm) |
| Accent usage | existing ReportTypeCard blue active state; var(--red) for incomplete history |

**Pattern notes:** Reuse ReportTypeCard and the report date controls. Share StockReport between screen and print. Left-align descriptive columns, center quantity headers/values/totals, and right-align currency headers/values/totals with matching cell padding and monospace values. Explain unavailable historical balances in visible copy.
