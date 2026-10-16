# Office Operations Control Centre: development report

Development base: main `ecad376257bd4c703529bd92f0678a523c96ed85`.
This package extends the existing tested ordering system. It reuses import
monitoring, manual Book Stock queueing, retry processing, saved calculations,
supplier snapshots, editable quantities and order history.

## Completed features

| Area | Delivered behavior | Development verification |
| --- | --- | --- |
| Office Operations | `/operations` shows Hounslow, Perivale, East Ham, Hayes, Gravesend, Watford and Streatham by stable store code; missing configuration is flagged | Verified with seven-store fixtures |
| Store readiness | Separate business dates/update times for Normal Sales, RTC, Wastage and Book Stock; missing/outdated/failing data indicators; mapping/price product counts; orders calculated today; pending Excel drafts | Verified |
| Data Quality | `/data-quality` reports all 11 problem classes, with store/supplier/problem/search filters, pagination, corrective links and Excel export of the complete filtered result | Verified |
| Calculation transparency | Separate Book Stock, receipts not posted, future arrivals, historical feeds, comparison dates/totals, forecast demand, saved stock stages, delivery stock, suggested/final units and cost | Verified |
| Pre-order validation | Saved-order review displays blocking errors, review warnings and excluded zero lines; supplier generation and download enforce server validation and explicit warning acknowledgement | Verified |
| Import reliability | Phase progress, row counts, attempt details, existing retry controls, safe diagnostic download, and guarded interrupted-run recovery | Verified with fixtures/mocks |
| Office table workflow | Deferred search, store/supplier filters, 50/100/200-row pages, versioned local preferences/reset, keyboard quantity navigation and loading/error states | Verified in Chromium |
| Live CRM / native PostgreSQL / Windows scheduling | No live access, deployment, scheduling or production migration performed | Still requires approved office acceptance |

### Operations definitions

- Store identities remain in PostgreSQL. The seven expected codes are surfaced
  even when an office store is missing/inactive; no store is silently created.
  The dashboard uses “East Ham” as its display label for code 0650.
- Movement data should cover yesterday in the London calendar. Book Stock should
  be refreshed manually for the current London day. Both the dashboard and
  pre-export review use this same policy.
- Verified successful zero-row movement reports count as covered/fresh for their
  reported date, rather than being mistaken for missing data.
- “Orders today” counts actual calculations/recalculations, per included store,
  using a new `orders.calculated_at`. Ordinary edits do not increment that count.
  Existing orders have no invented calculation date; they are counted after a
  new calculation records the timestamp.
- “Pending supplier drafts” means Excel has not been prepared, or the source
  revision changed. `supplier_orders.exported_at` records successful workbook
  preparation, not proof of client receipt and not supplier submission. The UI
  explicitly states that no order has been sent.

### Data Quality Centre

Findings include possible duplicate normalized product names, unknown product
codes, unmatched barcodes, missing supplier codes, missing/invalid current unit
prices, invalid/missing case-size references, missing report dates, negative
latest-snapshot stock, no recent Normal Sales history and inconsistent imports.
Unresolved failed imports are also listed as their own problem type.

Supplier prices must match the active product mapping, supplier id and current
supplier code, have an effective date no later than the London business date,
and have no expired validity date. Products explicitly marked unavailable from
an individual supplier do not become false missing-mapping findings. The cheapest
valid unit price remains the selection rule regardless of case size. Packaging
problems require review and never substitute a different price rule.

Coverage scans the last seven completed calendar days. A recorded successful
zero report covers that day. “No recent sales” means no recorded Normal Sales
rows in the last 28 days; recorded zero sales are not treated as missing history.
Inconsistency checks include a barcode linked to the wrong store-product store,
future-dated stock, and a latest successful nonempty import audit with no records
remaining in its reported range. Findings ask staff to verify corrections; they
never recreate deleted records.

Unmatched identifiers are retained from manual movement/stock imports and
barcode-enrichment previews in `import_quality_observations`. Repeated observations
update a timestamp instead of duplicating the same identifier/feed/store. Worker
failures retain structured unmatched codes/barcodes in the existing audit JSON.
A finding disappears from the unresolved view when a matching store mapping is
created; failed worker attempts are retained for audit and can be explicitly
retried. No product identity is automatically merged or created, and no missing
price is estimated.

The UI shows 100 findings per page. Excel includes **all** matching findings,
independent of the displayed page. More than 100,000 findings requires narrower
filters and returns a clear error rather than silently truncating the export.
Supplier filters intentionally show supplier-specific findings; global feed or
barcode findings are available with “All suppliers”.

### Pre-order review and workbook generation

`GET /api/orders/:id/validation` checks saved selected lines against current store,
product, supplier, mapping and dated price records. It checks date validity,
positive finite quantities, price consistency, manual overrides, source warnings,
missing comparison data, failed imports and stale business dates. Zero-quantity
lines are reported as excluded; invalid/negative quantities block export.

Changed or missing mappings/prices, inactive selections, invalid quantities and
empty positive selections block supplier output. Case sizes, manually adjusted
quantities and source-data warnings require explicit acknowledgement. Case sizes
are reference data; they do not change the selected unit price or manual units.

The supplier panel saves current edits, shows the validation report and lets staff
correct problems through linked screens. Supplier generation/export APIs require
an explicit JSON `acknowledgeWarnings` decision. Blocking issues cannot be bypassed
by that flag. Draft revisions are checked; workbook preparation locks the order
while assembling/stamping the snapshot. Regeneration clears the previous Excel
preparation timestamp. General calculation workbooks remain available for analysis;
the supplier-specific output is the validated final workflow.

An unchanged review/save now preserves the order revision, so it does not make an
otherwise current supplier draft stale. Quantity-only saves retain existing order
notes; notes are cleared only when explicitly submitted empty. Both behaviors
have a reproduced regression test.

### Reliability and diagnostic boundaries

The existing monitor now includes queued/downloading/downloaded/importing/success
phase progress, row counts, failed attempt/date details and diagnostic links.
Retry remains a separate explicit action and preserves the failed audit attempt.

Attempts active for more than two hours show recovery guidance. Staff must stop
or verify the office worker is stopped and explicitly confirm this before marking
an interrupted attempt failed. The server checks age and phase atomically; recent,
already completed and already recovered attempts are rejected. It retains previous
data and does not itself queue another job. The worker's existing importing-state
and transaction checks prevent a failed attempt from subsequently committing.
The system does not automatically declare a slow worker dead.

Diagnostic JSON contains the latest 1,000 allowlisted audit records, with an
explicit scope/limit. It omits source paths, filenames, commands, configuration,
credentials, arbitrary JSON details and raw error messages. Error summaries come
from fixed categories. Retry/duplicate references are included only if numeric.
Tests inject credential-like strings into errors, paths, filenames and arbitrary
JSON fields and verify they are absent from the download.

## Verification results

| Command / suite | Final result |
| --- | --- |
| `npm test` | 111 passed in 15 files |
| Python worker unit tests | 9 passed |
| `npm run lint` | Passed |
| `npm run build` | Passed, including TypeScript |
| `npm run test:system` using Chromium 153 executable | 78 passed, 0 failed, 0 skipped |
| Combined final tests | 198 passed |

New targeted coverage adds 13 application cases and 10 system cases to the prior
suite. Existing export tests now explicitly acknowledge fixture-data warnings,
matching the new review contract rather than bypassing validation. The full suite
retains 49 order-generation scenarios and the original Excel → worker → database →
dashboard → edit → supplier workbook → history flow.

The new system scenarios execute seven-store counts, pending/prepared Excel
transitions, all problem categories, store isolation, supplier/type filters,
actual XLSX parsing, dynamic barcode resolution, manual unmatched observations,
verified zero reports, diagnostic redaction/download, warning/price/mapping gates,
inactive/negative-line rejection, separate calculation values, saved timelines,
keyboard navigation, preference persistence/restricted storage/cross-order scope,
interruption recovery guards and repeated disposable migration application.

Exploratory checks found and corrected the initial orders-today query referencing
an absent line timestamp, the unchanged-save revision/note defect, and two table
preference edge cases. Final results above exclude exploratory failures.

## Prepared migration and operation guide

Review `migrations/manual/2026-10-16-office-operations.sql` before office activation.
It adds nullable calculation/preparation timestamps, the pending-draft index and
identifier-observation table. It does not rewrite identities, historical price
records, stock or sales. The migration ran only in disposable test databases,
including repeated application to verify idempotency. `schema.sql` is the fresh
baseline; existing databases must use the reviewed migrations.

Daily Head Office workflow:

1. Open **Office Operations** and inspect all seven store cards.
2. Check failed/stale/missing feeds; retry failed attempts after correcting their
   cause. Refresh Book Stock manually. For interrupted attempts, confirm the
   office worker is stopped before recovery and then retry separately.
3. Open the store's **Data Quality** findings and correct mappings/prices using
   the linked existing screens. Export findings for investigation when needed.
4. Generate an order, inspect product explanations, edit units and retain notes.
5. Review **Pre-order validation**, correct blockers and explicitly acknowledge
   accepted warnings. Generate supplier drafts and download each workbook.
6. Use order history to reopen saved orders. A changed source revision requires
   supplier draft regeneration before a new validated Excel preparation.

## Remaining dependencies and practical limits

- Real CRM exports, selectors, credentials and office Windows scheduling remain
  unverified and were not accessed. Existing office worker configuration and
  source-file layouts still require one-store acceptance before all seven.
- PostgreSQL tests use the existing disposable PGlite engine and protocol adapter.
  Native multi-session locking, multiple office workers and production-size
  import/quality-query performance need native PostgreSQL acceptance. SQL-error
  rollback tests retain the existing test-only simple-query wrapper limitation.
- Expected reports assume calendar-day movement feeds. Confirm any agreed shop
  closure/exception-day policy before using missing-day warnings operationally.
- Duplicate names are potential duplicates, not proof of identical products.
  Staff review remains required; no fuzzy identity matching/automatic merging is
  claimed. Older unmatched reports that were never retained cannot be recovered
  without their files; new observations and structured failures are retained.
- Supplier transmission and email are intentionally absent. Prepared/downloadable
  Excel drafts must not be described as sent orders.
- The office migration and native acceptance run require approval. This package
  was committed to main only; nothing was deployed or run on live office systems.

## Changed files

The list below includes application, schema, automation, regression and supporting
documentation changes in this package. The delivery message identifies the final
GitHub commit; this report's base commit is recorded above.

- `README.md`
- `automation/worker.py`
- `docs/office-operations-report.md`
- `migrations/manual/2026-10-16-office-operations.sql`
- `schema.sql`
- `src/app/api/data-operations/diagnostics/route.ts`
- `src/app/api/data-operations/recover/route.ts`
- `src/app/api/data-operations/status/route.ts`
- `src/app/api/data-quality/export/route.ts`
- `src/app/api/data-quality/route.ts`
- `src/app/api/operations/route.ts`
- `src/app/api/orders/[id]/supplier-orders/[supplierOrderId]/export/route.ts`
- `src/app/api/orders/[id]/supplier-orders/route.ts`
- `src/app/api/orders/[id]/validation/route.ts`
- `src/app/data-quality/page.tsx`
- `src/app/operations/page.tsx`
- `src/components/layout/data-operations-status.tsx`
- `src/components/layout/home-page.tsx`
- `src/components/layout/sidebar-nav.tsx`
- `src/components/operations/control-centre.tsx`
- `src/components/operations/data-quality-centre.tsx`
- `src/components/order-sheet/hooks/use-table-preferences.ts`
- `src/components/order-sheet/order-sheet-results-table.tsx`
- `src/components/orders/pre-order-validation.tsx`
- `src/components/orders/supplier-order-panel.tsx`
- `src/db/schema.ts`
- `src/repositories/orders.ts`
- `src/services/book-stock/book-stock-import.service.ts`
- `src/services/daily-sales/daily-sales-import.service.ts`
- `src/services/data-import-run.service.ts`
- `src/services/import-persistence.test.ts`
- `src/services/operations/control-centre.service.ts`
- `src/services/operations/data-quality.service.ts`
- `src/services/operations/diagnostics.service.ts`
- `src/services/operations/filters.ts`
- `src/services/operations/import-observations.service.ts`
- `src/services/operations/import-status.service.ts`
- `src/services/order-sheet.service.ts`
- `src/services/orders/order-validation.service.ts`
- `src/services/orders/supplier-order.service.ts`
- `src/services/rtc/rtc-import.service.ts`
- `src/services/wastage/wastage-import.service.ts`
- `src/types/operations.ts`
- `src/types/orderSheet.ts`
- `src/utils/operations-freshness.ts`
- `tests/e2e/browser-workflows.spec.ts`
- `tests/e2e/operations.spec.ts`
- `tests/e2e/worker.spec.ts`
- `tests/support/test-database.mjs`
