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
Wastage downloads, store-product matching against the office catalogue,
atomic office imports and unattended scheduling still require acceptance.
No office sales import or timer was started by this verification.

The operator subsequently supplied the Hayes RTC history for the same day.
Its 38 transaction lines aggregate to 35 barcodes and exactly 72.976, matching
the report grand total and an independent per-barcode reconciliation. All
transaction reasons are REDUCE TO CLEAR and all scanned dates are 15 October.
The RTC normalizer is barcode-mapped; matching those barcodes against the
store-specific office catalogue remains unverified.

This second acceptance run exposed that the RTC parser ignored Date Range
headings and could relabel a report with a different job date. It now validates
the single-day heading and transaction scanned dates, rejects inconsistent or
missing scanned dates, excludes ordinary price overrides when a Reason column
is present, and adds weighted RTC quantities with decimal arithmetic. The
original RTC workbook is not committed. Wastage acceptance is still pending.

The supplied Hayes Wastage export for 15 October contains the report title,
store and daily date range, but only "No Records Available" instead of product
lines. The normalizer was executed against this actual workbook and rejects
it with an actionable filter-verification message. This does not establish
zero business wastage and must not clear existing movements. No office data
was imported. A populated Wastage export is still required for reconciliation.

Regression tests cover `.xls` (including XLSX content under that extension),
`.xlsx` and uppercase extensions. Downloader tests also require the exact
Wastage report, a selected Date Range, and both fields equal to the requested
day; merely having two matching but outdated date fields is insufficient.

Wastage quantities exclude Store Use, positive/negative Stock Corrections or
Stock Adjustments, stocktake corrections, and transfers in either direction.
The same exclusion is applied before product aggregation in MSP and GloPOS
grouped reports and in spreadsheets/CSVs with a Reason column. These movements
are not reclassified into Normal Sales or RTC. Reports containing only excluded
movements do not bypass the worker's empty-import protection.

The populated Hayes Wastage report for 14 October was parsed without a database
connection: 85 source lines become 84 product codes, totalling 207.863 (Damaged
10; Out of Date 197.863). Every product quantity matches an independent source
aggregation. Requesting 15 October for this file is rejected. Office catalogue
matching and unattended imports remain pending.

## Historical Wastage download and import

The CRM Downloads page accepts up to 366 completed days and submits sequential
transactions of at most 31 days each. Every store/day/feed remains a separate
job. Select Wastage alone for a Wastage backfill. For example, 3 June–15 October
is 135 daily jobs per store, rather than a single period total. If a batch fails,
accepted batches remain queued; retry the same range with re-download unchecked
to resume without duplicating active, successful or failed attempts. Use Retry
in Office Operations, or explicitly re-download, to retry a failed day.

Progress refreshes every five seconds for the selected stores, feeds and dates.
It reports the latest attempt for each store/day/feed and shows active/failed
reports first. A queued report is not an imported report. Success means the
worker committed that file to the corresponding PostgreSQL feed. The links to
Wastage, Normal Sales and RTC show saved data. Changing filters does not cancel
jobs; closing the page does not cancel already accepted requests.

The worker resolves the application's HNS/PVL/EAS/HYS/GRV/WTF/STR identities to
the verified CRM markers 0365/0766/0650/0665/0566/0602/0388. Existing four-digit
store codes are preserved. Unknown identities fail rather than guessing a store.
Only feeds with complete_store_report=true can be claimed or queued nightly by
the database-backed profile; other feeds stay queued for a verified worker.

### Explicit office activation

After the operator has verified the real report contracts and authorized imports,
run the following in the Windows project folder. This is an explicit operational
action: it prepares a new isolated worker release, privately transfers DATABASE_URL
from the existing .env/.env.local, prompts for the hidden CRM login code, checks
the existing office database read-only, enables Wastage only, and starts the worker.
It also enables the 02:00 Europe/London timer for the stores marked Include in the
UI. It does not run migrations or deploy the web application.

```powershell
git pull --ff-only https://github.com/franklinajithan/mieszko-ordering.git main
if ($LASTEXITCODE -ne 0) { throw 'Git update failed' }
powershell -NoProfile -ExecutionPolicy Bypass -File .\automation\prepare-linux-worker.ps1 -ActivateWastage -EnableNightly
```

Existing queued Wastage jobs become eligible immediately when the worker starts.
Normal Sales and RTC remain disabled in this first activation profile. Book Stock
is never enabled by this tool. Nightly eligibility does not restrict explicitly
queued manual backfills. No credentials are printed or committed. The setup
requires office SSH/sudo access and package-download connectivity. Its native
Windows PowerShell execution and live systemd activation require office verification.

For a bounded check, the Linux wrapper accepts `--once --max-jobs 1 --store-id ID`.
Without a job limit, `--once` drains eligible queued jobs, not just one job. A
service stop lets the current job finish before claiming another; systemd waits
up to 2500 seconds before terminating the remaining process group. Empty reports
remain blocked and existing data retained. No automatic zero-wastage assumption
is made for No Records Available.

The repository regression tests exercise the historical UI/API queue, partial
batch recovery, latest-attempt progress, store isolation, application store-code
translation, one-job limits, feed gating, and mock-CRM download/parser/atomic
database imports. Activation tests mock PostgreSQL and systemd and ensure a failed
database preflight cannot install/start services or enable the worker profile.

If Windows PowerShell strips quotes from an inline SSH Python command, preparation
can succeed while credential transfer fails before activation. Credential reception
now executes a Python file directly and reads JSON on stdin, without `python -c`
or nested shell quotes. The receiver writes mode 600 atomically, preserves an
existing hidden CRM login, and never prints the connection string.

To resume that failed setup without package reinstallation, pass the exact prepared
release directory name to `prepare-linux-worker.ps1 -ResumeRelease NAME
-ActivateWastage -EnableNightly`. Resume verifies the runtime and activation script
exist, refuses to modify an already active worker, and copies the environment
receiver, unit generator and activation script before continuing. It never applies
migrations or reinstalls the prepared dependencies.

The initial office service start exposed that systemd's WorkingDirectory value
must not be wrapped in quotes (they become literal path characters). The generator
now writes the absolute path directly, while retaining required ExecStart argument
quoting. Regression tests run the real systemd-analyze verify command for all three
units, including a directory with spaces. Activation verifies the generated units
before installing any service; a verification failure cannot start the worker/timer.
