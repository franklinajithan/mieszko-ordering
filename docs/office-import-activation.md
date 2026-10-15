# Office activation guide — not activated

The development package includes a Windows PowerShell launcher, configurable
Playwright report downloader, PostgreSQL queue consumer, and atomic import worker.
No installation, task registration, database migration, or CRM access was performed
on the office PC during development.

## Database review

Back up the office database and review these manual scripts before applying them:

1. `migrations/manual/2026-10-15-data-import-runs.sql`
2. `migrations/manual/2026-10-15-book-stock-staging.sql`
3. `migrations/manual/2026-10-15-order-stock-options.sql`
4. `migrations/manual/2026-10-16-supplier-orders-and-manual-quantities.sql`

The existing `sql/20261014_future_delivery_expected_date.sql` is also needed if
future delivery dates are not already present. These files are intentionally not
executed by the worker or CI. `schema.sql` is a fresh-development-database schema,
not an upgrade script. Do not run it on the office database. Do not use `db:push`
as an automatic office upgrade.

## Prepare the Windows worker after approval

1. Install Python 3.11+ and run `automation/setup-worker.ps1` to create its local
   virtual environment and install Chromium. This installs no scheduled task.
2. Copy `automation/config.example.json` to `automation/config.local.json` and
   `automation/crm.example.json` to `automation/crm.local.json`.
3. Install the app dependencies with `npm ci` using Node.js 20.9+ before enabling the parser adapter. Replace example store IDs with actual `stores.id` values, and configure absolute
   paths, report column mappings, header rows and sheet names for each store/feed.
4. Set `DATABASE_URL` only in the worker's local environment. Never put database or
   CRM passwords in source control. Login steps can read environment variables.
5. Capture and verify the actual CRM selectors on the office PC. No selectors are
   guessed. The example intentionally has empty flows and cannot download reports.

Supported report steps are `click`, `fill`, `select`, `check`, `wait`, `popup`, `download`.
For example, a fill step has `action`, `selector`, and either `value` (supports
`{start}` / `{end}`) or `env` (the name of a credential environment variable).
A check step has `checked: true/false`. A final download step clicks the verified
Excel export control and saves the resulting file. For popups, use a `popup` step with a unique `name`, then set `page` on subsequent steps to that name. Set `frame` to a verified iframe selector for actions inside a frame. All controls still need office verification. No CRM writes are required.

## Report contracts

- Normal Sales, RTC Sales and Wastage are three independent files, tables and jobs.
- Movement reports must be complete for the requested store/date range; explicitly
  set `complete_store_report: true` only after verification. The import replaces
  that feed's requested range transactionally, so corrected/deleted lines do not
  linger after retries. It never writes the other feeds.
- A multi-day report must include an ISO daily date per row. A period-total report
  cannot be used as daily history. Single-day reports can omit the date column.
- Quantities use dot decimals; comma thousands separators are accepted. Ambiguous
  locale formats must be normalized by the downloader adapter before import.
- Book Stock is **manual only**. Use Stock Valuation Detail with negative stock
  exclusion unticked, then set `includes_negative_stock: true` after checking it.
- Files must contain product codes matching the selected store, with no totals or
  decorative footer lines. Use `header_row` and `sheet` for XLSX headers; more
  complex CRM layouts require a normalization adapter. Existing browser parsers
  remain available for interactive imports.
- Unknown codes, invalid quantities and invalid dates fail the whole automated import. Empty files fail by default. Only set `allow_empty_report: true` after verifying the CRM can produce a complete, valid zero-activity report; it is never allowed for Book Stock. A successful zero-row movement job records coverage in the audit table. Previous data remains intact. No fuzzy matching is performed.

## Run one controlled test after approval

Set local environment variables, queue a refresh from the dashboard, then run:

```powershell
.\automation\run-worker.ps1 -Config .\automation\config.local.json -Once
```

`-Once` drains queued work then exits. Without it the worker polls every 10 seconds.
Each run gets a unique download directory, so it cannot reuse a stale report.
Each downloader has a 40-minute timeout by default. State transitions are
`queued -> downloading -> downloaded -> importing -> success`, or `failed`.
Success and imported data commit in the same transaction. A crash during download
leaves an in-progress job requiring deliberate recovery; it never becomes success.

After one-store verification, a Windows Task Scheduler task can run the launcher
with `-EnqueueYesterday -Once` nightly. Enqueueing yesterday is idempotent and queues
only Normal Sales, RTC and Wastage. Book Stock is never queued by this flag.
No scheduled task is created by these scripts.

## Recovery

Stop other workers first. Use the virtual-environment Python executable with:

```powershell
python automation/worker.py --config automation/config.local.json --fail-stalled-minutes 120 --once
python automation/worker.py --config automation/config.local.json --retry-run 123 --once
```

A retry creates a new audited attempt; it does not erase the failure. Fix report
mappings or missing catalog products before retrying. Active work for the same
store/feed prevents duplicate retry jobs. Retain failed files for diagnosis under
normal company access controls. Abandoned browser-upload rows in
`book_stock_import_stage` are invisible to stock calculations and can be deleted
after review.

## Access boundary and remaining verification

This application currently assumes a trusted office network; it does not provide
staff login/RBAC. Keep it behind the approved office VPN/firewall until an access
control layer is supplied. Do not expose PostgreSQL directly to the internet.

Actual office CRM selectors, credentials, export layout normalization, Windows
execution, full PostgreSQL concurrency and scheduling require office verification.
The automated development suite uses isolated embedded PostgreSQL and never the
office database. It does not certify those external integrations.

## Optional scheduling script

`automation/install-schedule.ps1 -Config automation/config.local.json -At 02:00`
registers the three-feed daily task **only when explicitly run on the office PC**.
It uses the current signed-in Windows user, avoids duplicate task instances, and
contains no credential arguments. The PC must be on and that user signed in.
Use a separate continuously polling `run-worker.ps1` process for immediate manual
Book Stock requests. These installation/activation steps were not run in development.

## Supplier orders and preserved edits

The supplier-order migration adds an explicit manual-quantity flag and order
revision counter. Existing quantities differing from suggestions are marked as
manual during upgrade. Regeneration retains those edits for matching store products.
Supplier drafts are generated per store/supplier and downloaded individually. Any
later save/recalculation changes the source revision, preventing export of stale
supplier quantities until drafts are regenerated. Supplier orders are downloadable
drafts; the app does not email suppliers or submit anything to CRM.
