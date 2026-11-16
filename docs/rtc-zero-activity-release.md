# RTC zero activity

The supplied Eastham Price Override & RTC Sales History workbook contains `Date : 20-10-2026` and `No Records Available`, with no transaction headers. Its `Created On` value and filename contain 21 October. The legacy-format fix in 5556eed supports XLS/HTML exports but did not accept this empty layout. The business rule now explicitly includes RTC.

Recognized empty RTC reports (XLS, XLSX and valid header-only layouts) save Success, imported rows 0, activity **Zero RTC activity**, and dated coverage. Headerless no-records layouts require an RTC title and an embedded business date. Created/printed timestamps are excluded. Available store metadata and report dates are checked against the requested job. Unrelated reports, login pages, corrupt files, conflicting transaction/empty markers and wrong store/date remain errors. Identity absent from a report must come from the selected store or verified downloader context.

Manual RTC uploads now publish a whole validated report atomically, using the movement publisher shared with Wastage. A complete zero replacement clears earlier RTC quantities for that store/day. Matching products save successfully; unknown rows remain staged for Unmatched Products review. Mapping corrections and Refresh replay retained rows without downloading or adding quantities twice. Existing complete reports and manual edits remain protected from incomplete replacements.

Successful zero imports appear in saved RTC dates, import monitoring, Download Queue and recovery progress. Audit coverage satisfies order checks, data-quality coverage, Dairy export and nightly recovery even without transaction rows. Normal Sales, Book Stock and supplier prices retain their existing rules. No database migration is required.

## Historical jobs

After deploying both components, open Download Queue > Failed and choose **Re-download** for the affected Eastham RTC job for **20 October 2026**. The new linked attempt validates the report with the corrected parser; the old failed audit remains unchanged. Do not bulk relabel failures. Use Unmatched Products > Refresh after correcting mappings to replay retained stages.

## Office update

Publishing GitHub code does not deploy the private office app or Linux service. Stop the office app with Ctrl+C, then run Windows PowerShell:

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
.\automation\prepare-linux-worker.ps1 -Server '192.168.128.139' -ServerUser 'backend' -ActivateMovementFeeds -EnableNightly
if ($LASTEXITCODE -ne 0) { throw 'Linux worker release or health check failed' }
ssh backend@192.168.128.139 'systemctl show mieszko-import-worker.service --property=WorkingDirectory --value'
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify active worker release' }
npm run start
```

Keep the final window open. Confirm the printed worker release includes the new commit prefix, then re-download the selected failed job. Expected result: Success, 0 rows, Zero RTC activity, report date available. Verify order generation and Dairy export against that day.
