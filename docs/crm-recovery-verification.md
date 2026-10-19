# CRM download and import recovery — 19 October 2026

Implementation branch: `fix/crm-download-import-recovery`, based on main `f8660b7`.
This is a proposed repair, not a production deployment or a claim that the listed
Hayes jobs have recovered.

## Findings and evidence

| Area | Verified finding | Change |
|---|---|---|
| Normal Sales | Worker performed exact store-code or barcode lookup, with no operator resolution path. Normalizer always labelled sales identifiers as store product codes, even for explicit barcode headers. Header detection could select Product Name ahead of Barcode. | Prioritize identifier columns, preserve barcode mapping type, conservative numeric barcode equivalence, reject ambiguous matches, and require evidence-backed per-report alternative mappings. Item codes retain leading zeros and case; there is no fuzzy product-name matching. |
| Wastage diagnostics | Worker discarded normalizer errors and replaced them with the generic parsing message. MSP parser silently skipped bad quantities; its detection wrapper swallowed validation errors. | Structured error file, persisted file/row/field diagnostics, fail the entire recognized report on malformed quantities, retain previous database data. |
| Wastage formats | MSP recognized Qty only, and date extraction did not check all explicit daily groups/ranges. | Qty/Quantity, BIFF8/XLSX and sparse layouts, strict dates, explicit subtotal/metadata handling, exact Decimal aggregation, retained reasons and barcodes in audit details. |
| Retry | Every retry required another CRM download. | Separate Retry Import and Re-download, retained-file path restriction, checksum validation when previously recorded, new attempt IDs and inherited reviewed mappings. |
| Overlap | SKIP LOCKED protected a job ID, but did not prevent two different overlapping queued jobs from being downloaded concurrently. | Serialize claim selection with an advisory lock and exclude overlapping active jobs. Existing transactional store locks and fingerprint checks remain. |
| Visibility | Only coarse states and generic errors; progress bar represented ordinal stages as a percentage-like value. | Persist parsing/matching/importing/retrying stages in existing JSON audit details; show counters, errors and review controls, responsive mobile cards, no simulated percentage. |

### Actual files inspected

Retrieved previously supplied exports and executed the current normalizer:

| File | Outcome |
|---|---|
| Hayes_Sales_20261015.xls | 932 normalized product rows; total quantity **1959.195**; store product codes. Same row count as reported job #133, but the live job/file checksum has not been compared. |
| Hayes_RTC_20261015.xls | 35 barcode rows; total quantity **72.976**. RTC business parser was not changed. |
| Hayes_Wastage_20261014.xls | 85 source lines → 84 product codes; quantity **207.863**. Every product quantity equals an independent aggregation of raw source cells. |
| Hayes_Wastage_20261015.xls | Contains **No Records Available**, with no product lines. Correctly rejected. This does not establish zero wastage. CRM report/filter/data availability must be checked before any replacement. |

14 October Wastage source line Amount sums to 407.22. Source line Cost sums to
265.2748, whereas the report footer displays 265.2749. No financial amounts are
rewritten: the existing movement tables store quantities, not source monetary
transaction amounts. Financial reconciliation of the affected live reports is
still outstanding; no artificial adjustment was introduced.

SHA-256 evidence:

- Wastage 14 October: `faf89d4f3888067ca3fb15977e5e786893d07ead2a8edc9545e3d417288e4d6d`
- Wastage 15 October: `0410bf0377497637cd25fa4ce535b6993781560b1e020c1e9abcb04e7d976085`
- Sales 15 October: `96e20ebb0d20fd6a17c3f94e5454bb3d0d6970cbc388d1518e54a451ea9866cb`
- RTC 15 October: `976956c776f06e6576d5df8656f79938bb3e9f7391ccaaa4db4a7b92cf679463`

Original commercial exports are not committed. Regression fixtures reproduce
observed layout with synthetic product identifiers.

## Recovery and safety contract

- Matching failure blocks the whole import. No unmatched transaction is skipped.
- Review is available under Error details / review products on a failed job.
  Search only the job's store catalogue, select a verified product, and enter
  evidence. Resolutions are scoped to that report and its explicit import
  retries, never global catalogue aliases. Existing exact/ambiguous catalogue
  matches cannot be overridden. Review history is retained in the failed job.
- This uses the existing office application's access model, which has no separate
  administrator identity/role system. Same-origin checks protect new mutations;
  this change does not claim to add authenticated administrator attribution.
- Retry Import queues a new job referencing the failed report. It validates the
  source store/feed/date, retained path and any previously stored SHA-256, copies
  the original to the new attempt, and reruns parsing and matching. Older jobs
  without a recorded hash are revalidated and receive a hash on the new attempt;
  historical integrity cannot be proven retroactively.
- Every successful download now records its hash before parsing. A missing,
  changed or disallowed retained file fails explicitly; it never silently invokes
  CRM. Re-download remains a separate deliberate action.
- Temporary login-page failures and downloader timeouts have at most three
  attempts with 5 and 10 second backoff. Retry errors/delays are audited.
  Invalid formats, unknown products and unrecognized/configuration errors do not
  retry automatically. No blanket retry of arbitrary CRM errors was added.
- Source data replacement and success audit remain one transaction. Matching is
  checked before entering the write phase and rechecked inside the transaction.
  Fingerprints prevent replay from adding duplicate movements. Different source
  identifiers reviewed to the same product are summed, not overwritten.
- A stopped process can leave an active audit row. It is deliberately not stolen
  automatically from a potentially live worker. After verifying other workers
  are stopped, the existing `--fail-stalled-minutes` operational recovery can
  close abandoned attempts, followed by explicit Retry Import. Never invoke it
  while another worker may still be importing.
- Counters describe normalized product/date rows; duplicate source lines may be
  aggregated. Imported count is database product/date rows written. A verified
  unchanged replay reports zero writes, preserving the original import time.
- The five-second UI poll can miss short stages; stages are backend snapshots,
  not invented transfer percentages or guarantees that the worker is online.

## Schema and deployment

**No database migration is required.** Existing `data_import_runs.details`, file
path, counters and terminal statuses store the new data. No production data,
worker service, scheduler, credentials or Supabase project was changed.

Deploy the web application and worker together through the established isolated
release/activation workflow, only after production authorization. Older workers
do not understand import-only retry metadata. Stop old workers before activation.
Keep old downloads: configuration currently puts downloads inside each release.
For a new release, explicitly set `retained_download_directories` in its protected
`automation/config.local.json` to the exact trusted older download directories
needed for recovery. The worker defaults to its current download directory only;
never allow an entire filesystem root. This configuration was not changed live.

## Live Hayes job status

| Jobs | What remains unverified |
|---|---|
| Sales #367, #346, #325, #133, #130 | Actual unmatched identifiers, current store catalogue records, cause of each missing mapping, and live retry outcomes. #133 has a matching available 932-row source report, but no live file-hash association. |
| Wastage #369, #348, #327 | Actual 16–18 October exports and parser diagnostics. |
| Wastage #318, #317, #135 | Available 15 October export is empty; need live job/file association and CRM verification. None was converted to a successful zero report. |

Connected Mieszko Supabase projects were listed as inactive. The repository and
Linux activation code use a PostgreSQL office database (`mieszko-order`); no
working office connection or Linux session was available in this workspace.

## Read-only evidence collection

After this branch is available on GitHub, run the following from Windows
PowerShell at the office. It downloads only the collector source to a temporary
file, copies it to `/tmp`, reads the active service's working directory, and
produces an evidence ZIP using its existing protected environment. It does not
checkout a branch, deploy code, run migrations or change worker state.

```powershell
$ErrorActionPreference = 'Stop'
Set-Location 'C:\Users\Ajithan\Desktop\Code\Preorder\mieszko-ordering'
git fetch origin fix/crm-download-import-recovery
if ($LASTEXITCODE -ne 0) { throw 'Git fetch failed' }
$collector = Join-Path $env:TEMP 'collect-crm-evidence.py'
git show origin/fix/crm-download-import-recovery:automation/collect-crm-evidence.py | Set-Content -Encoding utf8 $collector
if ($LASTEXITCODE -ne 0) { throw 'Collector extraction failed' }
scp $collector backend@192.168.128.139:/tmp/collect-crm-evidence.py
if ($LASTEXITCODE -ne 0) { throw 'Collector transfer failed' }
ssh backend@192.168.128.139 'worker_app=$(systemctl show -p WorkingDirectory --value mieszko-import-worker.service); "$worker_app/.worker-runtime/venv/bin/python" /tmp/collect-crm-evidence.py --app-dir "$worker_app" --output /tmp/hayes-crm-evidence-20261019.zip'
if ($LASTEXITCODE -ne 0) { throw 'Read-only evidence collection failed' }
scp backend@192.168.128.139:/tmp/hayes-crm-evidence-20261019.zip .\Hayes_CRM_Evidence_20261019.zip
if ($LASTEXITCODE -ne 0) { throw 'Evidence download failed' }
```

Upload `Hayes_CRM_Evidence_20261019.zip` for the remaining catalogue comparison.
The collector excludes connection strings and credentials, opens PostgreSQL in
read-only mode, and refuses to overwrite an existing ZIP. It includes only the
specified jobs, their store product catalogue/barcodes and reports beneath the
active configured download directory. Missing/older reports are identified in
`jobs.json`; they still need to be supplied from retained release downloads.

## Files changed

- `automation/worker.py`: conservative matching, preflight, retained imports,
  hashes, overlap protection, bounded retries, persisted stages and counters.
- `automation/normalize-report.ts`: explicit sales mapping type, structured parser
  diagnostics, Wastage reason and barcode metadata.
- `automation/collect-crm-evidence.py`: read-only live evidence collector.
- `src/parsers/daily-sales/daily-sales-file-parser.ts`: identifier header priority.
- `src/parsers/wastage/msp-stock-adjustment-parser.ts`: strict sparse parser fixes.
- `src/services/download-queue.service.ts`: retry/review actions and diagnostic reads.
- `src/app/api/download-queue/route.ts`: validated same-origin retry/review API.
- `src/components/operations/download-queue.tsx`: real stages, counters, error
  review, product selection, import retry and mobile presentation.
- Regression coverage in `automation/tests/test_recovery.py`,
  `src/parsers/wastage/msp-recovery.test.ts`,
  `src/services/automation-normalization.test.ts`,
  `tests/e2e/worker.spec.ts`, and `tests/e2e/download-queue.spec.ts`.
- `src/services/import-persistence.test.ts` and an ExcelJS test buffer annotation:
  repaired pre-existing test TypeScript errors exposed by standalone typecheck.

## Verification

- Application tests: **176 passed** (`npm test`), including observed Hayes layout and invalid-format regressions.
- Python tests: **53 passed**, including conservative matching, changed-file rejection, bounded retries and cancellation during backoff.
- ESLint, standalone TypeScript check, and production Next.js build: **passed**.
- Browser/API/worker/database tests: **19 of 20 passed in the combined run**. The remaining queue-control test failed in fixture setup with PGlite socket's `bind message supplies 4 parameters ... requires 2` error; it **passed on isolated rerun**. Thus all 20 cases have passed, but the combined run was not clean. This test-server protocol flake remains a validation limitation; no production database change was made to mask it.
- Integration coverage includes all seven named stores × Normal Sales/RTC/Wastage, desktop and 390-pixel mobile queue controls, verified mapping review, import-only retries with CRM deliberately disabled, repeated-file idempotence, changed-file rejection, transaction rollback, operator pause/cancel protection and the read-only evidence collector.
- Earlier environment-only attempts encountered missing psycopg after session resume and a browser download failure. Workspace-local test dependencies restored execution. Two pre-existing test type annotations and a new parser type-narrowing issue were corrected before final type/build success.
- Actual prior Hayes files were rerun against the final parser: Sales 932/1959.195, RTC 35/72.976, Wastage 14 October 84/207.863; empty 15 October Wastage rejected.
- The repository's complete CI workflow will run on the pull request. Unrelated system-test suites were not represented as locally executed.

No production deployment or live Hayes import recovery is claimed.
