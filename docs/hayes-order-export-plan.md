# Hayes-compatible dairy order Excel export

Implementation target: reproduce the user's Hayes Dairy Order workbook, including 34 columns (A–AH) and separate Product / No Movement sheets.

## Inputs
- Store-specific product codes, MM/SP/WAB codes, EAN and department
- Seven daily sales figures, historical comparison periods and selected Max/Average/Min method
- RTC and wastage (avoid double counting RTC sales)
- Book stock as of a known date, received-but-not-posted quantities, future deliveries
- Supplier prices and case sizes; final editable shop order quantities

## Requirements
1. Generate a separate workbook per selected store with the original 34-column layout.
2. Preserve product identifiers as text and retain formula-driven calculated columns.
3. Validate missing or stale stock snapshots before calculating: never silently assume missing stock is zero.
4. Match uploaded data by store product code, barcode and supplier mapping; surface unresolved matches.
5. Keep the existing /order-sheet generation and export workflow functional during implementation.
6. Validate outputs against the supplied Hayes workbook, including the No Movement sheet.
7. Keep the main branch untouched until reviewed.

## Implementation sequence
- Map existing export API and order generation service to the reference workbook.
- Add a template-compatible ExcelJS exporter and row mapping.
- Wire exporter to the existing API behind a format selection.
- Add formula, row-count and mapping tests.
- Review output against the original Excel file.
