# Daily CRM downloads and editable store addresses

## Completed development

The new **CRM Downloads** navigation entry opens `/automation`. Staff can save
an HTTP/HTTPS CRM URL for each store, choose which stores are eligible for the
nightly queue, and request completed calendar dates. Changes are persisted in
PostgreSQL, not in a worker script. Credentials/query strings are rejected in URL
settings. The worker reads the current saved URL before every claimed job; an
already-running download keeps its established session.

Date requests are split into one audited job per store, day and selected feed.
Normal Sales, RTC and Wastage remain independent. The UI accepts up to 31 days,
only through yesterday in London time. Existing active attempts are skipped;
completed/failed attempts are skipped unless the operator explicitly requests
re-download. A multi-store request rolls back if any store is unconfigured or
inactive. Book Stock cannot be queued by this screen or the nightly profile.

`nebula_download.py` adapts the uploaded working Playwright workflow: Barcode
login, Reports → Explorer, the correct report category/name, Date Range with
the same From/To day, View Report, Export and the real Excel link. It runs headless
on Ubuntu and never uses the weekly-row selector. The authenticated CRM must show
the requested `Store Info` code before an export can proceed. Original login
codes and store addresses from the uploaded file are not committed to Git.

The worker supports CRM `.xls` exports through the existing application parsers.
Unknown products, wrong dates and invalid reports leave previous data intact.
Structured downloader error codes become actionable, allowlisted audit messages;
raw Playwright errors/filled credentials/command arguments are not exposed.

## Office update — explicitly run only after reviewing the change

The new table requires `migrations/manual/2026-10-16-crm-store-settings.sql`.
The six earlier migrations do not create this table. This upgrade adds only
`store_crm_settings`; it does not change existing sales/stock/order rows or seed
store addresses. The normal application still loads if this migration is missing;
the CRM settings API reports setup required.

In Windows PowerShell at the project folder:

```powershell
git pull --ff-only https://github.com/franklinajithan/mieszko-ordering.git main
if ($LASTEXITCODE -ne 0) { throw 'Git update failed' }
powershell -NoProfile -ExecutionPolicy Bypass -File .\automation\prepare-linux-worker.ps1 -ApplyCrmSettingsMigration
```

The explicit switch transfers the new sources/migration, prepares the isolated
runtime, creates a new custom-format backup on the Ubuntu host, checks its archive
directory, and applies the small transactional migration with error-stop/timeouts.
A backup or archive-check failure prevents migration execution. This is not a
restore test. It never starts the worker/timer, accesses CRM or deploys a web app.
Without that switch, preparation does not connect to the database.

Open `/automation` in the current app, save verified URLs and leave nightly
eligibility unchecked until acceptance. The supplied screenshot shows a newer
Hayes address than the uploaded script; confirm the other addresses as well.
The server profile uses database store IDs/codes rather than hardcoded store IDs.

## Controlled acceptance and activation still required

Preparation writes `automation/config.local.json` and `automation/systemd.local/`
inside the printed release directory. They are local, ignored files, and no units
are installed. The initial profile sets `complete_store_report=false` so unverified
exports cannot replace live data. Preserve that gate until actual report contracts
have been checked. Do not assume the three report layouts contain identical columns.

1. Store `DATABASE_URL` and `MIESZKO_CRM_LOGIN_CODE` in the server environment or
   protected `automation/env.local.json` (mode 600). Never paste credentials into
   chat or commit them. The runtime reads JSON directly; it does not shell-evaluate
   credential values.
2. Verify one real store/day in each feed, including store marker, selected report,
   From/To dates, exported product identifiers/quantities and app parser results.
   Office Date Range controls and popup/download timing are still acceptance items.
3. Set complete-report verification only for confirmed feeds, then perform one
   authorized import and independently check the PostgreSQL rows and dashboard.
4. Review the generated systemd unit paths/user/environment. The continuous worker
   consumes queued jobs; the separate 02:00 Europe/London timer queues yesterday
   using `--enqueue-only`. No Book Stock jobs are scheduled or consumed by this
   movement-only profile. Existing manual stock support requires its own verified
   downloader configuration.
5. Enable the systemd worker/timer only after office acceptance. Verify logs, retries,
   missing-report warnings and reboot behaviour. Persistent timers enqueue yesterday
   after a missed run; use the date-range UI for older gaps.

The app remains on its current host. Hosting it on Ubuntu so the dashboard stays
available while Windows is off is a separate deployment, not performed here.

## Verification

* Application unit tests: 127 passed.
* Python tests: 24 passed, including date/store checks, credential-file handling,
  generated profile contracts, Windows line endings and backup failure gates.
* Browser/API/worker/disposable PostgreSQL suite: 82 passed. The new integration
  reproduces a wrong-store URL, changes it through the API without changing worker
  config, downloads six daily reports, normalizes `.xls` files and verifies separate
  imports. It also tests queue deduplication and nightly enqueue-only behaviour.
* Lint, production build, Python compilation, Bash syntax and systemd calendar
  expression verification passed.

An initial integration run caught an invalid built-in callback passed to
Playwright's event wrapper. It was replaced with a Python function callback and
retested, including an Excel export that opens an additional popup. Final runs
have no failing tests.

All executions used fixtures/disposable PGlite over the PostgreSQL wire protocol.
No office database migration, CRM run or schedule activation was executed by this
development session. Native PostgreSQL multi-session concurrency and real CRM
acceptance remain office checks.

## Changed files

* `.gitignore`
* `automation/apply-crm-settings-upgrade.sh`
* `automation/configure-linux-worker.py`
* `automation/linux_worker.py`
* `automation/nebula_download.py`
* `automation/prepare-linux-worker.ps1`
* `automation/setup-linux-worker.sh`
* `automation/tests/test_crm_upgrade.py`
* `automation/tests/test_nebula.py`
* `automation/worker.py`
* `docs/daily-crm-downloads.md`
* `migrations/manual/2026-10-16-crm-store-settings.sql`
* `src/app/api/automation/imports/route.ts`
* `src/app/api/automation/stores/[id]/route.ts`
* `src/app/api/automation/stores/route.ts`
* `src/app/automation/page.tsx`
* `src/components/layout/sidebar-nav.tsx`
* `src/components/operations/crm-automation.tsx`
* `src/db/schema.ts`
* `src/services/crm-automation.service.ts`
* `src/validators/crm-automation.test.ts`
* `src/validators/crm-automation.ts`
* `tests/e2e/crm-automation.spec.ts`
* `tests/support/fixture-nebula-server.mjs`
* `tests/support/test-database.mjs`
# Office acceptance checkpoint — 16 October 2026

The operator ran the headless downloader on Ubuntu and supplied the resulting
Hayes Normal Sales report for 15 October 2026. The download completed in about
32 seconds. The supplied file contains XLSX data under an `.xls` filename.

The application normalizer was executed against this file without opening a
database. All 937 product lines aggregate to 932 product codes and exactly
1,959.195 in the report's quantity units. Every product quantity was compared
independently with the source rows, and the sum reconciles to the report's
Normal Sales and grand totals. The report contains only Normal Sales.

This acceptance run exposed binary floating-point addition in weighted sales
aggregation (4.675 + 0.805). The parser now uses decimal arithmetic and returns
5.48 exactly. A synthetic regression covers weighted quantities, repeated
product codes, excluded summary rows and rejection of a different report date.
The original office workbook is not committed to the repository.

This checkpoint verifies downloading and parsing one office report. Actual
RTC and Wastage downloads, store-product matching against the office catalogue,
atomic office imports and unattended scheduling still require acceptance.
No office sales import or timer was started by this verification.
