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
