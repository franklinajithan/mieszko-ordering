# Mieszko Ordering — consolidated functional development report

## Delivery status

The functional development below is implemented and locally verified. Actual office
CRM/Windows activation remains blocked by environment-specific controls, credentials,
report samples and approval to run/install/apply migrations. No office database,
CRM or PC was accessed. No Supabase, deployment, production migration, supplier
email or CRM submission was used.

## Completed features

| Objective | Implemented behavior |
| --- | --- |
| Supplier orders | Generate one persistent supplier draft per store/supplier from selected positive quantities. Choose the cheapest valid unit price regardless of case size. A missing offer does not hide another valid offer. Unpriced selected lines block generation with an actionable message. |
| Supplier Excel | Individual store/supplier files include supplier codes, item codes, products, units, unit prices, line costs, delivery date and totals. Source order revisions prevent stale exports after edits. Repeated generation updates the same draft IDs without creating duplicates. General workbooks also include supplier tabs and store identity. |
| Manual quantities | Immediate browser line-cost and selected-net-total updates using decimal arithmetic. Entering a positive quantity selects a previously zero line. Save/export/recalculate persist the current edits. Explicit manual overrides survive recalculation for matching store products, including deselected zero lines. |
| History/reopening | `/orders` filters by store, status and order-date range, with pagination. Reopen a sheet to adjust notes/quantities, save, export, or generate supplier orders. Sidebar and dashboard link to these workflows. |
| Dashboard | Independent seven-day Normal Sales, RTC Sales and Wastage quantities; active store/product counts; recent order values and price-check counts; live per-store import state and actual data dates. |
| Book Stock | Manual queueing from Dashboard and Book Stock, duplicate-request protection, progress/failure/success polling, atomic worker imports, staged browser chunks, previous snapshot preservation on failure, and no carry-forward of omitted products from an older snapshot. |
| CRM worker | PowerShell setup/run/schedule scripts; configurable Playwright main-page/popup/frame export flows; separate nightly movement feeds; manual-only stock queueing; strict validation; atomic data plus audit commit; explicit crash recovery/retry. |
| CRM file parsing | Unattended normalization reuses existing application parsers for supported MSP/GloPOS sales, RTC, wastage and stock reports. Barcode references resolve within the correct store; multiple barcodes for one product are aggregated before writing. Wrong-date reports are rejected. |
| Freshness/readiness | Per-feed missing store/date coverage warnings, source-table data dates distinct from worker audit success, supplier price age warnings, and explicitly verified zero-row movement reports counted as successful coverage. |
| Store/product accuracy | Same item code in different stores remains separate. Each store uses its own stock snapshot date in multi-store calculations, and quantities are pinned to that upload timestamp during generation. Future arrivals outside each product's stock-to-delivery interval are excluded. |
| APIs/repositories | Quantity and cost updates are atomic; draft items must belong to the order; supplier/period changes trigger calculation rather than leaving stale figures; source revisions invalidate supplier drafts after changes. |
| Concurrent development | Integrated the 21 commits through `fb93d55`, preserving the latest price and Generate Order rules. Removed duplicate wastage depletion introduced by combining parallel implementations. |

## Main changed files

- `src/services/orders/supplier-order.service.ts` and
  `src/app/api/orders/[id]/supplier-orders/**`: persistent generation/listing/export.
- `src/components/orders/{saved-order,supplier-order-panel}.tsx`,
  `src/app/orders/{page,[id]/page}.tsx`: history, reopening and supplier UI.
- `src/utils/order-item-edit.ts`, order-sheet hook/results/action components:
  live editing, saved exports and supplier-generation connections.
- `src/services/order-sheet{,-calculation}.service.ts`, `src/repositories/orders.ts`:
  manual preservation, per-store stock anchors, revision updates and atomic saves.
- `src/services/orders/recalculate-saved-order.service.ts` and supplier/period routes:
  working recalculation endpoints.
- `src/services/import-readiness.service.ts`, preflight/status routes, dashboard and
  Book Stock components: feed coverage, actual import dates and refresh actions.
- `src/db/schema.ts`, `schema.sql`, `migrations/manual/**`: prepared schema changes.
- `automation/{worker.py,crm_download.py,normalize-report.ts,*.ps1,config.example.json}`:
  office runner, parser integration and explicit scheduler installer.
- `src/services/{import-persistence,automation-normalization}.test.ts`, worker tests,
  forecast and calculation tests, `.github/workflows/verify.yml`: verification.

## Database changes prepared, not applied to office

1. `2026-10-15-data-import-runs.sql` (existing queue/audit migration).
2. `2026-10-15-book-stock-staging.sql` (atomic chunk visibility).
3. `2026-10-15-order-stock-options.sql` (persisted stock/delivery options).
4. `2026-10-16-supplier-orders-and-manual-quantities.sql` (supplier drafts, manual
   overrides, order revision counter).
5. Existing future-delivery date migration if the office lacks it.

`schema.sql` is a fresh development baseline. Do not apply it to an existing office
database. Integration tests apply schema/migrations only to isolated embedded
PostgreSQL.

## Verification results

- Application tests: 87 passed across 14 files.
- Worker tests: 9 passed.
- ESLint and TypeScript checks: passed.
- Next.js production build: passed (compilation, TypeScript, route generation).
- Normalizer CLI: executed successfully with `node --import tsx` on a sample daily
  sales CSV; two source rows became one correct product/day total without DB access.
- SQL-backed integration tests cover separate feeds, stock staging/rollback,
  supplier grouping/export/revision checks, retained manual edits, per-store stock
  dates, repeated item codes, and actual manual-import data status.

These results are local. They do not claim a Windows execution pass, real CRM
acceptance, real office schema compatibility, or full multi-process load testing.

## Remaining work genuinely requiring office inputs or access

1. Capture/verify authorized CRM URLs, login environment variables, report controls,
   popup/frame selectors and exported sample layouts for every store ERP.
2. Confirm complete-store report coverage, negative-stock inclusion and valid
   zero-activity report behavior before enabling those configuration flags.
3. Review/approve migrations against a backup; then install/run the Windows worker
   for one store and register scheduling after acceptance. No scripts were run on
   the office PC during this work.
4. Validate representative real reports and supplier orders against a test copy of
   office data. Runtime performance and Windows scheduling depend on that PC.

The existing application assumes a trusted office network. Staff login/RBAC is not
part of this functional completion package. Supplier transmission/email is not
implemented or executed; completed supplier drafts are downloaded as Excel files.

See `office-import-activation.md` for concrete setup, parser, scheduling and recovery
steps. Publication SHAs are listed in the final delivery response.
