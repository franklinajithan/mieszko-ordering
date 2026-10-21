# Zero-wastage handling

This extends 60fb1b4. That commit already made recognized MSP empty reports succeed in the worker, accepted matching movement quantities for ordering, and counted successful imports with unmatched products as completed with review items. It did not connect manual zero-row uploads to audited coverage, handle sparse header-only reports consistently, or validate empty-report store metadata before normalization.

## Behaviour

- Manual Wastage uploads use a server-validated whole report. Recognized empty XLS (BIFF8), XLSX and CSV reports record Success, imported rows 0, activity **Zero wastage**, and the selected/verified business date. A successful replacement removes earlier Wastage quantities for that store/day in the same transaction as the audit record. The saved-date screen includes zero reports.
- The Python normalizer verifies business dates and available store names/codes before discarding metadata. Zero-row worker imports require explicit parser evidence, rather than accepting every empty normalizer output. Unreadable workbooks, login forms, unrelated layouts, contradictory empty/data rows, multiple report dates and wrong store/date metadata remain errors; failed validation leaves saved quantities intact. Files without embedded store/date metadata continue to use the operator's selected store/date or the verified downloader context; the system cannot prove identity absent from the source.
- Matching quantities and unknown identifiers are saved atomically. The Download Queue displays **Imported — unmatched products awaiting review**. Manual reports retain the full normalized report in the existing staging tables, using the same count/hash contract and partial-publication ownership as the Python worker. Mapping corrections and Unmatched Products > Refresh queue retained-stage replay. Replay replaces subtotals, never adds them; prior complete reports and manual edits remain protected while an incomplete replacement is staged.
- Coverage, order preflight, Dairy workbook checks and data-quality checks already consult successful audit dates; a transaction row is not required. The queue and recovery API also expose verified zero activity for the progress display.
- Normal Sales, RTC, Book Stock and supplier prices do not receive this automatic zero-Wastage rule. No historical audit is relabelled.

## Historical failures

After updating both installations, open **Download Queue > Failed**, inspect the Wastage error and report date, then choose **Re-download** on the specific job. This creates a linked audited attempt and runs the corrected validation. A wrong-store, wrong-date, unreadable or unrelated report remains failed. This action deliberately downloads fresh bytes; it does not trust an arbitrary historical file path or infer success from the old error message.

For product mapping failures, correct the product master/mappings and click **Unmatched Products > Refresh**. Where a verified normalized stage exists, the worker replays it without downloading again. Older failures without such a stage require Re-download. Nightly recovery continues to honour cooldown, retry budget, parser-version gates and operator pause/cancel controls. Successful zero reports have coverage and are excluded from missing-report recovery.

## Update the office app and backend@192.168.128.139

Code publication is separate from office deployment. GitHub's workflow verifies source; it does not deploy the Windows app or private Linux worker. From the office Windows PC, stop the existing app with Ctrl+C, then run this in Windows PowerShell:

```powershell
$ErrorActionPreference = 'Stop'
Set-Location 'C:\Users\Ajithan\Desktop\Code\Preorder\mieszko-ordering'
git switch main
if ($LASTEXITCODE -ne 0) { throw 'Cannot switch to main' }
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'Git update failed' }
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Office application build failed' }
.\automation\prepare-linux-worker.ps1 -Server '192.168.128.139' -ServerUser 'backend' -ApplyReconciliationMigration -ActivateMovementFeeds -EnableNightly
if ($LASTEXITCODE -ne 0) { throw 'Linux worker release or health check failed' }
npm run start
```

The existing release script packages committed source, prepares an isolated Linux release, backs up/checks the database archive before additive reconciliation migrations, transfers the existing database configuration privately, activates the three verified movement feeds, installs the nightly schedule and runs server health checks. No new schema migration is introduced by this fix. Keep the final PowerShell window open for the office app.

Visit http://localhost:3000/wastage and upload a known zero report; verify its date and zero quantities. Check Download Queue > Completed for **Zero wastage · Report date available**, then generate the comparison order and Dairy workbook. Review historical failures individually using the flow above. Actual office reports, database contents, network access and service health require this office-side acceptance.

## Verification

- 196 application unit/integration tests and 58 Python worker/systemd/release checks passed; ESLint, TypeScript and production compilation passed.
- The full local system run passed 140 scenarios; its one new export test had an invalid empty shortfall-period fixture. After correcting that fixture and adding two further scenarios, all ten zero-wastage system/browser tests passed. Together these runs exercise 143 distinct scenarios, including real BIFF8 XLS and XLSX bytes, header-only files, corrupt/login/unrelated inputs, store/date checks, zero replacement and coverage, generation and Dairy export, progress counts, all-unmatched uploads, repeated manual imports, Unicode identifiers, retained-stage replay and historical retry audit preservation.
- Final local compilation used cached real Geist font assets because the environment could not fetch Google Fonts. No font/build configuration change is committed; GitHub Actions runs the standard build and complete system suite.
- Checks use a disposable database and offline CRM fixtures. The office app, Linux service and live historical reports have not been deployed or verified by these checks.
