# Download Queue

Open **Download Queue** in the sidebar (`/downloads`). It is separate from CRM
Downloads, where staff maintain store URLs and request date ranges.

The queue screen lists every attempt, with 50-row pages, store and feed filters,
report dates, job IDs, retry links, stage, row counts and errors. Views separate
Processing (downloading/downloaded/importing), Waiting, Paused, Completed (saved
successfully), Failed, Cancelled and All history. A resumed attempt stays in All
history; only a successful import counts as Completed. Counts cover the selected
store and feed, not just the visible page. Reads refresh every five seconds in
visible tabs, never overlap, and are cancelled when filters change or the screen
closes. Closing the page does not stop the Ubuntu worker.

## Controls

- **Pause:** closes a waiting/downloading/downloaded attempt before it can import.
- **Resume:** queues a fresh attempt for the same store/feed/dates and links it to
  the paused attempt. It does not reuse the original worker's run ID.
- **Cancel:** closes a waiting/downloading/downloaded or paused attempt. Previously
  saved data remains. A cancelled report can subsequently be re-downloaded.
- **Re-download:** creates a fresh attempt for a successful, failed or cancelled
  report. An overlapping active job is reused rather than duplicated.

Pause and Cancel are cooperative import controls, not an immediate termination of
a remote CRM session. A download already underway may finish, but its stopped
attempt cannot import. The import transaction checks its audit status under a row
lock before changing feed data. Once an atomic database import is committing,
controls cannot interrupt it or undo committed data. Refresh to see its outcome.
Jobs whose date range was never captured must be requested again with explicit
dates from CRM Downloads; Book Stock must still be requested manually.

## Compatibility and audit

The queue controls need no new schema migration. Deploy the updated Ubuntu worker to apply the report-date scheduling described below. Operator stops use the
existing terminal `failed` audit state plus `details.queue_control` of `paused` or
`cancelled`. Existing workers claim only `queued` records, validate `importing`
inside the import transaction, and never overwrite terminal failed/success states
in error handling. Therefore they cannot consume a stopped attempt. Resume creates
a different ID to prevent a still-running old downloader from writing to a resumed
job. Resumed audit entries use `queue_control=resumed` and record `resumed_as`.

Queue APIs, CRM progress and Office Operations present operator states explicitly;
Data Quality excludes operator stops from import-failure findings. Missing-report
warnings remain, since stopping a job does not establish valid data coverage.
Control endpoints reject cross-origin submissions and use the same store advisory
lock order as imports and report queue generation. No real supplier orders are sent.

## Verification

Disposable PostgreSQL/browser tests cover screen filtering and views, pause/resume
history, cancellation/re-download, duplicate suppression, cross-origin rejection,
invalid filters and protection of importing jobs. Offline worker tests hold a mock
download open, pause/cancel it through the real API, then release it and verify the
older worker cannot replace existing sales or mix RTC data. Office CRM execution
and actual server timing remain separate operational checks.

Verified for this change: 164 application tests, 45 Python worker tests, 21
browser/database integration scenarios, ESLint and the production Next build all
passed. No live office database or CRM session was used for verification.

## Current report and next reports

The screen now includes a global **Processing now** panel and the next five
waiting CRM reports above the filtered table. It remains visible when viewing
Waiting or filtering to another store, so current activity does not disappear.
Current reports show store, feed, business dates, job ID, recorded stage, start
time and the actual filename once the worker records it. The recorded stages are
opening CRM/downloading, downloaded/validating, and importing into PostgreSQL.
An attempt recorded as active for over two hours displays a worker-check warning.

The next list uses ascending report dates, then ascending job IDs for equal dates,
matching the updated worker selection for active MSP stores with saved CRM settings. It excludes paused,
cancelled and manual Book Stock jobs. The worker still selects only its enabled
feeds; this list shows waiting candidates, not a claim that the worker is online
or that an unenabled feed will run. Book Stock remains separately manual.
All queue history views now show oldest report dates first, with store/feed and
attempt ordering to keep ties stable. CRM daily import progress also uses report dates. Navigation and view shortcuts are buttons.

The list is a PostgreSQL stage snapshot refreshed every five seconds, not a
network transfer percentage. Stop controls can prevent an old attempt importing
while its existing CRM session finishes; the active panel reflects audit states.

Current/next refinement verification: 164 application tests, five queue browser/
database scenarios, ESLint and the production build passed.


## Missing report dates and progress

Both **Download Queue** and **CRM Downloads** include **Report dates and missing downloads**. In Download Queue, select a store/feed and set **Check report dates from / To**. The initial range covers the last seven completed London calendar days. Book Stock is not part of movement report coverage. CRM Downloads uses its selected stores, feeds and dates. Up to 366 dates can be checked at once.

The checker builds every expected store/feed/day, including dates with no audit job. It distinguishes missing data, saved rows without a complete import, failed attempts, partial imports, waiting/processing and paused jobs. A previously successful report stays available after a failed re-download, and verified zero reports count as complete. Partial publication ownership keeps an unfinished report out of the completed count. Counts cover the whole selection, with 50-row pages in chronological order; **Show only dates without a complete report** can be unchecked to show saved dates too.

Each eligible gap has **Download this date**. The API rechecks the store, CRM settings, completion and active jobs under the same store lock used by imports. Concurrent clicks reuse an existing active attempt, including legacy active jobs without recorded dates. It never replaces a completed report through a gap button. Paused reports must use Resume. A partial report also links to Unmatched Products; another download alone cannot repair an unchanged product mapping.

The completion bar counts complete stored reports divided by expected store/feed/days, refreshing every five seconds while visible. It reaches 100% only when all expected complete reports are available. Current jobs have stage bars: 1 opening/downloading, 2 validating, 3 saving, and 4 complete after a successful import. These bars represent recorded stages and completion, not a file transfer byte percentage.

The updated worker claims the earliest report date first, even if its retry was queued later than newer dates. Already running jobs finish normally. Equal dates use ascending job IDs; undated legacy jobs follow dated jobs. The global next list reflects that order, subject to the feeds actually enabled on the worker. Update both the website and Ubuntu worker to use this behaviour.

Date coverage verification: 177 application tests, 58 Python tests, lint, TypeScript and the production build passed. All 120 unique system/browser scenarios passed across full and targeted runs. The ten new coverage scenarios verify chronological queue/CRM history and both worker profiles, missing/partial/failed/waiting dates, retained partial ownership, saved manual rows, verified zero reports, previous successful imports, real fixture download/import, simultaneous duplicate clicks, active legacy jobs without dates, pause/configuration/origin/date guards, full-range pagination, stage progress, shared CRM actions and a 390px mobile layout. Tests used a disposable database and offline CRM fixtures; the office deployment and live CRM remain separate operational checks.
