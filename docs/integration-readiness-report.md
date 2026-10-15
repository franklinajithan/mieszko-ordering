# Mieszko integration verification and readiness

## Scope and outcome

Verification started from GitHub main `188771e26b36094bf4d3227132aa49bf92cc6819`.
The application was exercised through a production Next.js server, real HTTP
requests, Chromium, generated Excel workbooks, the Python CRM downloader and
worker, and a disposable PostgreSQL engine. Reproduced defects were fixed with
regression coverage. No office credentials, PC, CRM or database were accessed.
No orders/emails were sent, no deployment occurred, and no office migration ran.

The ordering workflow is verified with fixtures. **Office production acceptance
remains incomplete**: native PostgreSQL concurrency, real CRM selectors/reports,
Windows execution and Task Scheduler require a separate approved office run.

## Final verification

| Check | Result |
| --- | --- |
| `npm test` | 91 passed, 15 files |
| `python -m unittest discover -s automation/tests -v` | 9 passed |
| `npm run lint` | Passed |
| `npm run build` | Passed, production Next.js build and TypeScript checks |
| `npm run test:system` with Chromium executable override | 61 passed, 0 failed, 0 skipped |
| Distinct Generate Order scenarios | 45 passed, including independent quantity expectations |
| Total test cases across final application, worker and system suites | 161 passed |

These are final-run counts; failed exploratory runs are not counted as passing.
Initial failures included real defects, an incorrect whole-unit rounding oracle
(corrected to the existing two-decimal business rule), test locator/date handling,
and embedded adapter protocol limitations. The final suite uses no retries.
CI now runs application tests, worker tests, lint, build and browser/system tests;
execution of that hosted CI job is separate from the local results above.

## Feature assessment

| Feature | Classification | Evidence and limits |
| --- | --- | --- |
| Separate Normal Sales, RTC Sales, Wastage | Verified | Actual Excel normalization and Python imports, independent sums, enabled/disabled feed calculations; no joined-row multiplication |
| Seven-store/product retrieval | Verified | Repeated item codes and shared barcodes across all seven stores, exact scoped quantities and department/store filters |
| Demand forecast and stock projection | Verified | 45 order scenarios plus application regressions; zero/high/fractional demand, negative/missing stock, multiple periods and deliveries |
| Cheapest valid supplier unit price | Verified | Case sizes 1/6/24/1000, ties, zero/invalid/missing offers, effective dates and inclusive expiry boundaries |
| Manual edits and regeneration | Verified | Browser immediate cost, atomic save, workbook export, reopening and concurrent repeated regeneration preserve units |
| Supplier order grouping and Excel | Verified | Seven store-specific groups, persisted revisions, actual XLSX downloads parsed for quantity and unit price; unpriced/stale draft regressions |
| Order history and reopening | Verified | Browser navigation, persisted edited quantity and supplier workbook download |
| Dashboard and freshness | Verified | Independently seeded 300 Normal Sales / 7 RTC / 3 Wastage totals, active counts, stale and missing-import warnings, status API |
| Manual Book Stock refresh | Verified | Browser queues request, offline downloader/worker completes, UI reports success; generated order reads exact worker snapshot |
| Import retries, empty/unknown/duplicate reports | Verified | Real Python CLI, duplicate timestamps retained, corrected and manually changed data reapplied, explicit retry linkage, empty/unmatched safety |
| Atomic worker imports | Partially Verified | Injected SQL failure restores deleted movement data and records failure using simple-query fixture wrapper; native PostgreSQL protocol/locking acceptance still needed |
| Windows CRM downloader | Partially Verified | Real Python Playwright against offline login, popup, iframe, date fields, negative-stock setting and Excel download; actual CRM unverified |
| Windows scheduler | Partially Verified | Scripts reviewed; nightly enqueue executes 21 movement jobs, no Book Stock jobs, and repeated enqueue is idempotent; Windows task registration not executed |
| Native office PostgreSQL deployment/migrations | Blocked | No office access authorized; native server/container unavailable in this environment |

“Verified” means the stated fixture-backed development scope. Screen rendering
and ordering actions were tested; this does not claim exhaustive click coverage
of every unrelated catalogue administration form or a production load/security
audit.

## Reproduced defects and corrections

1. **Saved order/history routes redirected away from their implemented pages.**
   Removed obsolete `/orders` and `/orders/:id` redirects; retained the new-order
   redirect. Browser history, reopening, editing and exporting now execute.
2. **A newly imported backdated price replaced a more current effective price.**
   Latest quote retrieval now orders by effective date, import time and id, and
   excludes future/expired records. Regression reproduced the wrong supplier.
3. **Supplier price expiry was unsupported.** Added optional `valid_until`, API,
   UI and import persistence support; expiry is inclusive and invalid date
   ranges are rejected. Prepared the migration without touching office data.
4. **Price import deadlocked with a single database connection.** Reads and writes
   inside its transaction now use the transaction connection. A five-second API
   regression completes with pool size one; pool size is explicitly configurable.
5. **Expected generation/input failures became HTTP 500 responses.** Added a
   shared `InputError`, service-boundary generation validation, correct 400
   responses, and strict quantity precision checks to prevent silent rounding.
6. **Book Stock browser refresh could be rejected as cross-origin behind Next's
   internal hostname.** Same-origin checking uses the browser-facing Host;
   malformed/cross-site origins remain rejected. Real browser queueing passes.
7. **Worker snapshot timestamps lost PostgreSQL microseconds in JavaScript.**
   Exact snapshot identifiers are retained for lookup and deletion; tests cover
   two snapshots within one millisecond and downstream generated stock values.
8. **Duplicate files were reapplied with misleading fresh timestamps.** Added
   source/data fingerprints scoped to store, feed and period. Unchanged reports
   retain original import time and an explicit duplicate audit/status message.
9. **Historical duplicate fingerprints suppressed legitimate corrections.**
   Detection now considers the latest overlapping successful import and current
   stored data; manual imports and a correction reverting to an older report
   cannot be hidden. Newer manually uploaded stock snapshots invalidate a prior
   worker fingerprint too.
10. **Configured store identity was not checked against PostgreSQL.** Active
    store/code checks and optional raw-report store-marker validation reject
    mismatched configuration before importing.
11. **Sales-status API accepted impossible dates and raised PostgreSQL errors.**
    ISO calendar validation now returns HTTP 400 before querying the database.
12. **Quantity explanation claimed upward rounding.** Corrected the UI wording
    to match the actual existing two-decimal rounding behavior.

Psycopg automatic prepared statements are disabled for compatibility with
PostgreSQL protocol proxies. A test-only simple-query wrapper handles the PGlite
socket adapter's error recovery limitation during the injected SQL failure;
production connection/error handling otherwise remains exercised by the real CLI.

## Data and scenario coverage

Fixtures cover Hounslow (0365), Perivale (0766), Eastham (0650), Hayes (0665),
Gravesend (0566), Watford (0602), and Streatham (0388), two departments, three
products and three suppliers. Store-specific sales scale with store id so data
mixing changes expected results. Item codes/barcodes intentionally repeat across
stores. Original Excel normal-sales rows contain duplicates for aggregation.

For the base milk example, independently calculated movement is
`4 + 1 + 0.5 = 5.5` units/day. Stock 20 less two days' depletion leaves 9;
three days' demand is 16.5, so the expected suggestion is `16.5 - 9 = 7.5`.
Supplier SP wins at £1.10 per unit despite its larger case. Manual quantity 13
produces £14.30 and is retained in the saved order and exported workbook.

The numbered scenarios in `tests/e2e/generate-order.spec.ts` cover:

- Normal-only and each optional movement feed; zero, high and fractional sales.
- Ignored, negative, excess and missing stock; missing historical days.
- One/several/all seven stores; duplicate selection ids; separate departments.
- One/several suppliers; missing mappings, invalid offers, equal prices, varied
  case sizes, future/backdated/expired prices and inclusive expiry.
- No/one/multiple future deliveries, excluded future deliveries, snapshot-date
  arrivals and arrivals after the forecast horizon; missing delivery dates.
- Minimum/average/maximum across comparison periods; invalid/empty inputs.
- Manual precision rejection, repeated/concurrent generation, unique order rows,
  shared barcodes and store-specific missing-feed warnings.

The continuous system test imports 21 Excel movement reports, confirms separate
PostgreSQL values, opens the dashboard, generates seven-store orders, edits a
quantity, creates supplier drafts, parses the final workbook, checks history and
reopens the edited order. Separate real-browser tests exercise the Generate Order
form, save-before-export, immediate cost changes, supplier download and manual
Book Stock queue/status flow. Twelve catalogue/status API reads are also executed.

## Reproduction and database limitations

Follow the isolated verification commands in README. The test database launcher
creates an in-memory PGlite PostgreSQL engine on loopback port 55432, applies the
fresh baseline and manual migrations, and seeds fixtures. The application and
psycopg connect through the PostgreSQL wire protocol; office URLs are never read.
The production server uses loopback port 3100 and the fake CRM uses port 3200.
Existing servers are rejected rather than reused. Playwright tears down servers.

Native PostgreSQL/Docker binaries were absent; package installation was blocked
by this container's privilege restrictions. The embedded engine is substantive
SQL/transaction integration, but its multiplexed connection cannot establish
native multi-session lock or throughput behavior. Concurrent HTTP generation was
executed with a serialized connection pool and preserved data correctly; native
multiple-worker and connection-pool contention remains an acceptance dependency.

The normal Chromium download failed in this environment. Actual browser tests
ran using an available Chromium 153 executable selected via
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. CI uses managed Chromium installations.

## Prepared migration and office acceptance work

`migrations/manual/2026-10-16-integration-corrections.sql` adds optional price expiry
and lookup/fingerprint indexes. It ran only in disposable test databases.
Existing office installations must review this and earlier prepared migrations;
`schema.sql` is a fresh-database baseline, not an office upgrade command.

Remaining work requires real environment evidence:

1. Run the same fixtures and regressions on disposable **native** PostgreSQL with
   multiple connections/workers; verify locking, cancellation and error recovery.
2. Obtain actual exports from each CRM/store/feed; verify selectors, leading-zero
   codes/barcodes, store markers, dates, totals and negative-stock configuration.
3. On an approved Windows test PC, validate PowerShell/venv paths, Chromium, task
   working directory, interactive login availability, timezone and restart/retry.
   The scheduled task uses an interactive logged-in user; unattended logged-out
   operation has not been established.
4. After approval, review/back up the office DB and apply prepared migrations;
   verify one store before enabling all seven. This work was not performed here.
5. Approve sample supplier workbooks with office staff; no real supplier order
   was transmitted. Confirm production-sized import duration and retention.

No known reproduced failure remains in the final accessible test suite. There
is no claim that office integration is production-ready before the above gates.

## Changed files and commits

Changes are grouped below; the final GitHub commit identifiers accompany this
report in the delivery message and Git history.

- Runtime/API: `next.config.ts`, `src/db/client.ts`, `src/lib/api/http.ts`,
  `src/lib/api/same-origin.ts`, `src/utils/input-error.ts`,
  `src/app/api/data-operations/{book-stock,status}/route.ts`,
  `src/app/api/order-sheet/{generate,sales-data-status}/route.ts`,
  `src/app/api/imports/supplier-prices/route.ts`, `src/validators/schemas.ts`.
- Database/repositories: `src/db/schema.ts`, `schema.sql`, prepared migration,
  `src/repositories/{book-stock,supplier-prices}.ts`.
- Services: `src/services/order-sheet{,-calculation}.service.ts`,
  `src/services/orders/supplier-order.service.ts`,
  `src/services/book-stock/book-stock-import.service.ts`,
  `src/services/supplier-prices/supplier-price-import.service.ts`.
- UI: `src/components/layout/data-operations-status.tsx`,
  `src/components/order-sheet/order-sheet-results-table.tsx`,
  `src/components/supplier-prices/supplier-price-import-form.tsx`,
  `src/lib/api/supplier-prices.ts`.
- Automation: `automation/{worker,crm_download}.py`.
- Regressions/harness: `src/services/import-persistence.test.ts`,
  `src/lib/api/same-origin.test.ts`, `playwright.config.ts`,
  `tests/e2e/{api-surfaces,browser-workflows,crm-downloader,generate-order,worker}.spec.ts`,
  `tests/fixtures/seven-stores.sql`,
  `tests/support/{test-database,fixture-crm-server}.mjs`,
  `tests/support/{fixture-crm,simple-query-worker}.py`.
- Tooling/docs: `package.json`, `package-lock.json`, `.gitignore`,
  `.github/workflows/verify.yml`, `README.md`, this report.
