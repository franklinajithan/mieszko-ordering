# Dairy workbook export

On Order Sheet, select stores, suppliers, departments, order/delivery dates and comparison periods. Generate the order, review quantities, then click **Dairy workbook** beside Export Excel. Current quantity edits are saved before downloading. This export works for MSP stores including Hayes, as well as other configured stores; it is separate from the existing generic and HO template exports.

The layout follows the supplied Hayes dairy reference: ProductCode, selected supplier codes, barcode, product name/group, comparison sales, optional daily sales, the selected Max/Average/Min sales calculation, RTC, Wastage, stock, not-posted deliveries, future deliveries, forecast, shortfall, projected stock, required demand, suggested Order Qty and editable Shop Order Qty. Saved supplier unit prices/case sizes, the chosen supplier, line cost and warnings follow these columns. Date headings come from the order settings. Daily headings include the full year; enable **Day-by-sales required** and select the daily range to include them.

A single-store workbook contains **Product**, **NO Movement**, and **Order details**. Multiple stores get separate pairs of tabs, keeping identical product codes isolated. Product includes any nonzero sales, stock, losses, deliveries, suggested or final quantity; remaining zero-activity products go into NO Movement. Only products included in the generated order are exported, not unrelated catalogue records or historical template rows.

Identifiers remain text, including leading zeroes. Quantities retain four decimal places and negative stock. Missing supplier codes/prices stay blank. Disabled stock/RTC/Wastage/future sources are labelled not used and left blank. Order details records order/delivery dates, method, inclusion settings, periods, saved revision, stock dates, current stock-source checks and coverage warnings. These checks describe the sources at export time; importing new reports requires regenerating the order before exporting updated quantities.

Sales aggregation, stock-plus-not-posted and the nonnegative current-stock balance have Excel formulas with saved result caches. Estimated line cost uses Shop Order Qty and the chosen net unit price, rounded to four decimals like the saved application calculation, displayed as currency. Yellow Shop Order Qty cells accept nonnegative decimal quantities. Editing them updates Excel line cost; Excel edits do not write back to the app. Forecast, shortfall, required demand, projected stock and suggested quantity remain the saved calculation results, because they depend on dated stock simulation. Change source inputs and regenerate in the application to update those outputs.

This is a planning/review workbook. Supplier-order generation and supplier-ready downloads continue through the existing validation and warning acknowledgement workflow. Nothing is sent to a supplier by this export.

## Source readiness

The supplied screenshots show no Hayes book stock, old Perivale stock (20 August), and no WAB price upload. Check current statuses before generation. Upload the required stock report when **Consider Book Stock = Yes**, or explicitly choose No when planning without it. Verify supplier mappings/prices and completed comparison-date imports, including partial/unmatched reports. The uploaded historical example is a layout reference; its old quantities and dates are not copied into new orders.

## Verification

Tests cover saved manual decimals, separate suggested/final quantities, negative-stock formulas and zero caches, leading-zero barcodes/product codes, zero-activity separation, Max/Average labels, daily and period headers, per-store separation, disabled data sources, browser autosave/download and origin/ID validation. Tests use disposable data; they do not establish live Hayes source completeness.


Validation completed with 177 application tests, lint, TypeScript and a production build. All 125 unique system/browser scenarios passed across the full regression run and the final targeted export/browser run. The final targeted run passed all ten cases, including five new dairy-export cases. Cached zero results were also verified with an independent workbook reader.

Rendered Product, NO Movement and Order details for visual review and scanned recalculated formulas for errors. The preview engine displays numeric-looking text as numbers, so identifier fidelity was checked independently in the native XLSX: product codes and barcodes remain string cells with text format, including leading zeroes. A temporary in-memory quantity change also verified the line-cost formula, then restored the saved value. Desktop Excel itself was not run here.
