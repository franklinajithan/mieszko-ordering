# Ubuntu worker preparation

The Ubuntu server can host the existing Python import worker and headless
Playwright downloader independently of the Windows office PC. Preparation does
not activate either component. Actual store login/report selectors, complete
report layouts, database configuration and seven store IDs remain prerequisites.

From Windows PowerShell in the project, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\automation\prepare-linux-worker.ps1
```

This packages committed worker/parser sources with `git archive`, excluding
environment files, local CRM configurations, downloads and backups. SSH/scp use
normal interactive authentication; no passwords are stored in the script. Each
invocation gets a new release directory under `~/mieszko-worker/releases`.
Existing applications, system Node and login profiles remain unchanged.

Shell scripts have an explicit LF Git attribute, including when Windows Git uses
`core.autocrlf=true`. The launcher also strips trailing CR characters from the
transferred bootstrap before Bash executes it. This prevents `set: invalid option
name` failures caused by Windows line endings. An already transferred release can
be repaired with `sed -i 's/\r$//' automation/setup-linux-worker.sh` in its directory.

The Linux script downloads an isolated Node 22 from nodejs.org, verifies it against
the official HTTPS SHA-256 manifest, installs locked npm dependencies without
install scripts, creates a Python virtual environment and installs worker/browser
dependencies. Playwright's `install-deps chromium` may prompt for sudo and installs
Ubuntu browser libraries. If virtual environment creation fails, the script uses
sudo to install the Ubuntu `python3-venv` prerequisite and retries. The final smoke check opens local HTML in headless Chromium;
it makes no CRM or database requests. Dependency downloads require internet access.

Use the printed release directory when resuming a failed preparation:

```bash
bash ~/mieszko-worker/releases/RELEASE/automation/setup-linux-worker.sh
```

No app server, import worker, systemd unit, timer, cron entry or database migration
is started by these scripts. Do not put real credentials into committed JSON.
Do not treat `PREPARED ONLY` as evidence of a verified CRM import.

## Activation work still required

* Configure verified per-store CRM flows with `headless: true` and Linux paths.
* Verify report contracts from `office-import-activation.md` against actual exports.
* Configure a protected runtime environment, real database store IDs and application
  parser paths. Credentials must be entered locally, not shared in chat.
* Test one authorized store/date/feed, verifying imported rows and store isolation.
* Add a scheduler in Europe/London time after verification. Queue only Normal Sales,
  RTC and Wastage; preserve manual-only Book Stock requests. Keep continuous queue
  consumption separate from nightly enqueueing so manual requests can run promptly.
* Verify interruption/retry and missing-report monitoring before unattended use.

The dashboard still needs its own available application host when Windows is off.
Database availability alone does not make the Windows-hosted dashboard available.
