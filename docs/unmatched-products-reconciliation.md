# Unmatched Products reconciliation

The dedicated `/unmatched-products` page now collects failures across the full import history and checks identifiers against the current store product master. Product Upload remains a separate workflow. Click Refresh after installing this version to populate the persistent queue.

## Operator flow

1. Refresh, then select store, identifier type, feed, status, search and report dates. The server returns 50 records per page.
2. Download Excel. The export contains the entire filtered set, including records beyond the former 1,000-job limit. Identifiers are text, preserving leading zeros. The workbook includes instructions, filters, frozen headings and action dropdowns.
3. Use MATCH_EXISTING with the exact existing product code for that store. Use ADD_NEW with New Product Code, Product Name and Department. A new product-code identifier must use that exact CRM code as its new code. A barcode identifier also needs a canonical New Product Code.
4. Leave Action blank for products that need more investigation. Upload Corrected Excel. Review the paginated changes and row errors; Download Validation Results provides a workbook with generated validation status. Fix errors before approving.
5. Enter an operator name, check the approval box and Approve Updates. The installation has no authentication system: this name is self-reported, not a verified login identity.
6. Approval revalidates the current master and performs all proposed changes in one transaction. Any failure rolls back the batch. Repeating approval or uploading the workbook again does not create duplicate products or mappings.
7. Product Upload and adding a barcode also trigger reconciliation. Resolved identifiers leave the Pending view; their original identifiers, affected runs and approval history remain available in Resolved / All and Audit History.

Supplier Code is an optional audit reference. The system does not invent a supplier or supplier-price relationship; manage those through the existing product/supplier screens.

## Import safety and compatibility

Approved product-code aliases and barcodes are scoped to a store. Database triggers coordinate Product Upload with reconciliation using the same store advisory locks as the worker, enforce mapping store identity, and prevent canonical product codes from colliding with aliases.

Normal Sales, RTC and Wastage now save matching rows immediately for new report dates while retaining unresolved identifiers and the full validated report in staging. The queue displays **Partial / needs review**, saved and rejected row counts, and the remaining unknown identifiers. Partial reports remain `failed` in the audit table for compatibility with earlier worker/queue controls; the UI derives Partial from the audit metadata. They are never counted as fully successful imports.

`crm_partial_publications` records ownership and the exact fingerprint of each partially published store/feed/day. An improved mapping triggers a retained-stage replay that recomputes the known subtotal and replaces that owned day; it never adds quantities to an existing subtotal. Resolving the final identifier atomically writes the complete report and clears partial ownership. Multiple CRM identifiers mapped to one product are summed before persistence, so retries cannot duplicate sales, RTC or wastage quantities.

Earlier complete reports (including verified zero reports) and existing manual data are protected: a partial replacement stays staged for those dates until complete. Manual edits to a partial subtotal invalidate its fingerprint and protect it from subsequent partial overwrites. An older attempt cannot overwrite a newer saved report. Book Stock remains an atomic snapshot.

The dashboard labels quantities that include partial reports. Order preflight excludes partial dates from complete coverage, warns that quantities are incomplete, and export validation requires acknowledgement of the warnings. Matched quantities are visible, but are not represented as complete demand.

Eligible retries use the latest failed or partial report in an overlapping range and run when any remaining identifier becomes resolvable. They skip newer/active overlapping attempts and operator-controlled paused/cancelled jobs. Refresh also upgrades a legacy staged all-or-nothing failure once, allowing its known rows to publish without first correcting every unknown product. The retry carries a signature of the mappings; refresh cannot repeatedly requeue an incompatible worker's failure with the same mappings. Historical failed attempts remain immutable audit evidence.

Failed reports retain validated normalized rows with row count, mapping type, original source hash and normalized-data hash. Automatic reconciliation retries reuse the parent's staged report only for the same store, feed and exact dates and after verifying the staged count/hash. If no verified stage exists, the worker downloads again. Staging rows for a successfully completed attempt are cleared in the same successful transaction; failed-attempt stages remain available. Older failed files are retained on the office server; arbitrary stored paths are not accepted as validated inputs.

Descriptions are retained where parsers supply them. Original historical failures often contain only identifier arrays, without descriptions or transaction counts. These fields remain unavailable when the source did not record them; job counts are not misrepresented as transaction counts. Exact matching against a newly uploaded master resolves identifiers without guessing.

Parsing errors stay outside the identifier queue. Existing empty-Wastage and wrong-date checks remain enforced. No change was made to infer dates from a filename or treat an empty report as valid.

## Release from the office Windows PC

The development environment could not reach `192.168.128.139` (`Network is unreachable`). No production database migration, backup, application restart or worker deployment was performed here.

After pulling the tested commit, stop the local Next.js process before rebuilding. From the existing project directory:

```powershell
$ErrorActionPreference = 'Stop'
Set-Location 'C:\Users\Ajithan\Desktop\Code\Preorder\mieszko-ordering'
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'Git update failed' }
.\automation\prepare-linux-worker.ps1 -ApplyReconciliationMigration -ActivateMovementFeeds -EnableNightly
if ($LASTEXITCODE -ne 0) { throw 'Worker release failed' }
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Application build failed' }
npm run start
```

The existing release script transfers committed source only, creates an isolated Ubuntu release, privately transfers the local database connection, prompts for the CRM login code if needed, and activates Normal Sales, RTC and Wastage. The reconciliation upgrade applies both `2026-10-20-unmatched-products.sql` and `2026-10-20-partial-crm-imports.sql`. The script creates a custom-format backup of the existing `mieszko-order` database and checks the archive directory before applying SQL with ON_ERROR_STOP. A failed dump/check blocks the migration. This verifies archive readability, not a full restore rehearsal.

For an already prepared release, run `bash /path/to/release/automation/apply-reconciliation-upgrade.sh` on Ubuntu before activating that version. Do not use an old prepared release to activate the new worker code. The startup preflight rejects missing reconciliation tables before claiming jobs. The migration is additive; rolling back the app/worker should retain these audit/staging tables.

Visit `http://localhost:3000/unmatched-products`, click Refresh, download a fresh workbook and review a small known correction first. Verify affected reports in `/downloads` and compare published totals after their complete imports finish. These office URLs were not verified remotely.

## Remaining live acceptance

Hayes jobs 543, 546 and 547 need inspection in the actual office database after release. Jobs 539, 541, 544 and 545 require their original Wastage report bytes plus live error details to establish the parser failure. Those records/files are not in this checkout, and the office server is unreachable. Do not claim those specific failures were fixed based on synthetic tests.

There is no web-deployment step in GitHub CI; it verifies source and tests. The application is the user's local Windows Next.js process. Production verification requires the office network and that running process, not a Vercel deployment.

## Development verification

- TypeScript and ESLint checks passed; Next.js production build passed.
- 177 application unit/integration tests passed, including 20,001 identifiers, full-history export, Excel text preservation, validation output, duplicate mapping rejection, cross-store isolation, batch rollback, repeat approval, automatic reconciliation and migration reapplication.
- 49 Python tests passed, including backup/archive failure gates and missing-migration startup protection.
- All 103 system/browser cases passed in the final partial-import run. The extension adds coverage for all three feeds, progressive correction, exact final totals, repeated retries, manual/complete/zero-report protection, barcode matching, rollback and legacy staged failures. The diagnostics fixture asserts that invalid new cross-store barcode writes are rejected before transactionally simulating corrupt historical data for diagnostics.
- Browser coverage exercised export, corrected upload, preview, explicit approval, refresh, audit and 390px mobile layout. API/worker coverage verified existing Product Upload auto-reconciliation and replay of a retained validated report with the downloader deliberately configured to fail if invoked.

These results used disposable local data and offline CRM fixtures, not the live Hayes database or reports.

## Nightly behaviour and updating an existing installation

The nightly scheduler still queues the previous day's new movement reports for enabled stores/feeds. It does not automatically re-download every historical failed or partial attempt. Mapping corrections queue eligible reprocessing immediately; saved validated stages are reused where possible. Download/parsing failures still require operator Retry / Re-download, and parser errors may need a fix first.

After deploying the partial-import extension with the release command above, click Refresh in Unmatched Products. Older failures with a retained validated stage can publish matching rows once without waiting for every correction. For an older failure without a stage, use Re-download in Download Queue; the new worker will save its matching rows while retaining unmatched identifiers. The worker and nightly timer must be running for queued work to execute.
