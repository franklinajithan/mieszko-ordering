# Office dashboard performance correction

## Problem and changes

Office logs showed repeated Operations requests lasting 3–4 minutes and Data
Quality lasting about 3.6 minutes. Even unrelated CRM settings reads queued
behind this work. Development compilation added a separate cold-start delay.

The data-quality query previously found the latest store snapshot with a
correlated scan of stock history for each candidate stock row. It now groups
snapshot timestamps once per store and joins those results. Product names are
normalized once for duplicate detection, and dated supplier prices are selected
once before joining the store catalogue. Import monitoring aggregates each of
the four separate feeds by store before joining the status report.

Concurrent identical overview, quality and status reads share their pending
server work within a process. Completed responses are not cached: a later read
can see a newly imported report or corrected price immediately. Store, supplier,
problem type and business date scopes are included in quality read keys.

Operations and monitoring polling cannot start overlapping reads. Quality filter
changes cancel obsolete browser requests. CRM progress polling pauses in hidden
tabs. Read requests have a 30-second timeout with a retry message; writes and
imports retain their existing execution semantics. Cancelling a browser read
does not cancel an already executing database query or an import job.

## Reproducible disposable benchmark

Run `node tests/support/operations-performance.mjs`. It creates an in-memory
PGlite database from the schema, with 3,000 products and 15,000 stock rows. It
never loads office credentials. Before/after result sets are asserted equal.

Measured on the development test host, with no concurrent build:

| Check | Previous query | Revised query | Identical results |
| --- | ---: | ---: | --- |
| Duplicate product detection | 30 ms | 14 ms | Yes: 2 products |
| Latest negative-stock findings | 19,813 ms | 12 ms | Yes: 1,000 products |

These are component query timings on disposable data, not office API latency
guarantees. Actual office timings need checking after the app update. This
change does not remove Next development-mode compilation overhead.

## Verification and application

Verification completed: `npm test` (164 passed), `npm run lint` (no warnings or
errors), `npm run build` (passed), and the Operations plus CRM automation
Playwright suites (16 passed). Both disposable benchmark comparisons passed.

Unit tests cover concurrent-read sharing, scope isolation, retry after failure,
fresh reads after completion, read timeout and caller cancellation. Operations
integration coverage additionally checks independent store snapshots, historical
negative stock, expired/future prices, supplier filtering and immediate visibility
of price corrections. Existing browser scenarios cover dashboard summaries,
quality Excel exports, import recovery and mock CRM download/import processing.

No migration, database recreation, worker reactivation or production deployment
is required. Stop the existing Windows development app with Ctrl+C, pull latest
main with `git pull --ff-only`, and restart with `npm run dev`. Then check Office
Operations, Data Quality and CRM Downloads. The existing Ubuntu worker remains
independent of this app restart. Verify its actual import results and any failed
attempt error separately; passing mock tests does not establish office success.
