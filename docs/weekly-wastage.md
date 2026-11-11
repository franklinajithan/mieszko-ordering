# Weekly wastage workbooks

Run this on the Ubuntu Mieszko Ordering worker as its existing Linux user.
It uses the protected worker environment and the CRM URLs in Ordering for all
active MSP stores. The CRM account needs access to Reports → Explorer.

Install LibreOffice Calc if it is missing, then install the timer from the
deployed Ordering checkout.

```sh
sudo apt-get install libreoffice-calc
bash automation/install-weekly-wastage.sh
```

The timer runs every Monday at 08:00 UK time. A run downloads the previous
completed Monday–Sunday's Item Sales, RTC, Wastage and Daily Sales by Department
exports. It creates a processed workbook per store and one combined summary in
`~/Mieszko/Weekly Wastage/Weekly Waste DD.MM.YYYY - DD.MM.YYYY/`. Failed stores
are retried three times total. The dated folder is published only when all
stores pass summary validation. A rerun skips an already published week.

To run the previous completed week on demand and view the results in the journal:

```sh
sudo systemctl start --no-block mieszko-weekly-wastage.service
journalctl -u mieszko-weekly-wastage.service -n 80 --no-pager
systemctl list-timers --all mieszko-weekly-wastage.timer
```

To recover an older week or choose a different output directory, run the script
as the worker user with `--week-start YYYY-MM-DD` and/or `--output /path`.

```sh
.worker-runtime/venv/bin/python automation/weekly_wastage_job.py --week-start 2026-11-02
```
