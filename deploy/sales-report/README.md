# Mieszko Sales Report downloader

Install into /home/backend/mieszko-daily-sales-reports, using the same Python environment as the ordering worker. Configure and enable the supplied systemd timer to run at 06:00 Europe/London. Manual requests are handled by the existing /api/sales-report/run route.

Generated files: output/YYYY-MM-DD/{store}/*.pdf, output/YYYY-MM-DD/manifest.json, output/Mieszko_Sales_Reports_YYYY-MM-DD.zip.

Each store downloads six reports. Valid PDFs are reused on reruns. Failed PDFs are listed in failed_reports.txt and manifest.json; a ZIP may still be incomplete. Requires Playwright and Chromium in the worker environment.

Store endpoints and login barcode are currently configured in the Python script; move them into protected runtime configuration before exposing this service beyond the trusted internal network.
