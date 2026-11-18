"""Systemd timer entrypoint for saved Till Receive schedules. Disabled by default."""
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
STATE = Path(os.environ.get("TILL_RECEIVE_STATE_DIRECTORY", str(Path.home() / ".mieszko-till-receive")))
STORES = {"HNS", "PRV", "EHM", "HAY", "GRV", "WAT", "STR"}
PERIODS = {"1h": 3600, "2h": 7200, "12h": 43200}

def read_json(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default

def main():
    config = read_json(STATE / "schedule.json", {})
    if config.get("paused", True):
        return 0
    if os.environ.get("TILL_RECEIVE_EXECUTION_ENABLED") != "1":
        print("Till Receive execution is disabled; skipping.")
        return 0
    frequency = config.get("frequency")
    stores = config.get("stores", [])
    if frequency not in (*PERIODS, "nightly") or not stores or any(s not in STORES for s in stores):
        print("Invalid schedule", file=sys.stderr)
        return 1
    now = datetime.now(timezone.utc)
    stamp_file = STATE / "schedule-last.json"
    previous = read_json(stamp_file, {})
    if previous.get("updatedAt") != config.get("updatedAt"):
        previous = {}
    try:
        last = datetime.fromisoformat(previous["lastAttempt"]) if previous.get("lastAttempt") else None
    except ValueError:
        last = None
    if frequency in PERIODS:
        due = not last or (now - last).total_seconds() >= PERIODS[frequency]
    else:
        london = now.astimezone(ZoneInfo("Europe/London"))
        hour, minute = map(int, config.get("time", "00:00").split(":"))
        due = (london.hour, london.minute) >= (hour, minute) and (
            not last or last.astimezone(ZoneInfo("Europe/London")).date() < london.date()
        )
    if not due:
        return 0
    STATE.mkdir(parents=True, exist_ok=True)
    lock_path = STATE / "run.lock"
    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        print("Till Receive is already running; skipping.")
        return 0
    try:
        os.close(fd)
        stamp_file.write_text(json.dumps({"updatedAt": config.get("updatedAt"), "lastAttempt": now.isoformat()}))
        history_path = STATE / "history.json"
        history = read_json(history_path, [])
        python = os.environ.get("TILL_RECEIVE_PYTHON", str(ROOT / ".worker-runtime/venv/bin/python"))
        selected = list(stores)
        results = []
        started_at = datetime.now(timezone.utc).isoformat()
        progress_path = STATE / "progress.json"
        def publish(current, active):
            progress_path.write_text(json.dumps({"mode": "scheduled", "active": active, "startedAt": started_at, "current": current, "stores": selected, "results": results, "completed": len(results), "total": len(selected)}))
        publish(None, True)
        for store in selected:
            publish(store, True)
            try:
                result = subprocess.run([python, str(ROOT / "automation/till_receive.py"), "--store", store],
                    cwd=ROOT, capture_output=True, text=True, timeout=240, check=False)
                output = (result.stdout + "\n" + result.stderr)[-12000:]
                status = "success" if result.returncode == 0 else "failed"
            except (OSError, subprocess.TimeoutExpired) as exc:
                output, status = str(exc), "failed"
            entry = {"at": datetime.now(timezone.utc).isoformat(), "store": store,
                     "mode": "scheduled", "status": status, "output": output}
            history.insert(0, entry)
            results.append(entry)
            publish(None, True)
            history_path.write_text(json.dumps(history[:200], indent=2))
            print(store, status, flush=True)
        publish(None, False)
    finally:
        lock_path.unlink(missing_ok=True)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
