# Office import worker configuration

The ordering dashboard queues manual Book Stock refresh requests in
`data_import_runs`. A queued request does **not** download a file or update stock.

## Activation checklist (office PC only)

1. Review and apply `migrations/manual/2026-10-15-data-import-runs.sql` to the **office** PostgreSQL database.
2. Confirm the existing CRM downloader exports the **Stock Valuation Detail** report with negative-stock exclusion unticked.
3. Confirm the existing Book Stock importer validates `BK.xlsx` and writes the correct dated stock snapshot.
4. Configure the office worker to poll `data_import_runs` for `source_type='book_stock'` and `status='queued'`.
5. Claim each job atomically, download the file, validate and import it, and record the final outcome.
6. Only report success **after** the importer commits the snapshot. If any step fails, mark the job failed and retain the previous stock snapshot.
7. Test one store before enabling all stores.

## Import states

`queued -> downloading -> downloaded -> importing -> success`

A failure at any non-terminal stage goes to `failed`. No failed job should be reported as a successful stock refresh.

## Nightly reports

Normal Sales, RTC Sales, and Wastage are **three separate CRM feeds**.
Do not merge RTC into normal sales. Book Stock is manual, not nightly.

## Security

The queue API must be restricted to authorized staff before exposure beyond a trusted office network. Never expose local PostgreSQL credentials or CRM login details in browser code. Avoid directly exposing the office database to the public internet.

## Important limitation

The repository currently has queue and audit services, but **no verified office CRM worker integration**. Do not schedule jobs until the real downloader and importer have been verified.
