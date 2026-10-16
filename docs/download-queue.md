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

No schema migration or worker replacement is needed. Operator stops use the
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
