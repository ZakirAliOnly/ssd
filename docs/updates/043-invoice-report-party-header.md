# Update 043: Invoice report party header

Remove the repeated Client / Party column from the invoice report print layout. Show the selected party (or All Clients) in a bold 20px heading above the date range on the right of the existing blue title bar. Long names wrap without overlapping the report title. Adjust the totals label span to three columns so amounts stay aligned. Screen filters and the management table are unchanged.

Validation: rendered the actual print JSX with the shared header/footer in an isolated local sandbox. Browser checks covered a selected party, a long party name and All Clients; seven columns and matching totals alignment were confirmed. Existing lint findings remain in the unrelated data-loading effect and unused userProfile variable. No database changes required.
