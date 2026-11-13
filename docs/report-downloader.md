# Report Downloader

Open **Overview → Report Downloader** in the office app. Select the stores,
add the date ranges under the reports you want to run, then select **Start
downloads**. Each selected range produces one Excel workbook per store and
report. Manage shop URLs in **CRM Downloads**.

Select a recent run to check its progress or download completed workbooks in a
store-wise ZIP. A run with some failed reports still offers a ZIP when it has
completed workbooks. Retrying reuses valid saved workbooks and runs the missing
reports again.

## Office deployment

Deploy the updated Next.js app and Python files on the office Ubuntu server.
The app uses the same database-backed worker, Chromium and protected login
configuration as the existing Report 6 screen. LibreOffice Calc is needed when
CRM exports legacy XLS files. Grant the office app service account write access
to the configured archive directory.

By default, the screen uses the existing Report 6 worker and archive settings
(which can fall back to the Daily Wastage settings). To override them, set
`REPORT_DOWNLOADER_WORKER_DIRECTORY` to the checkout with
`.worker-runtime/venv/bin/python` and `REPORT_DOWNLOADER_ARCHIVE_DIRECTORY`
to an existing absolute archive directory. Restart the office web service after
deploying. Archive files and job ZIPs live under the `report-downloader`
subdirectory. Use the existing office access controls for this screen and API.
No database migration is required.
