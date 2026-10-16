"""Offline downloader gate to reproduce a UI control during an active download."""
from pathlib import Path
import subprocess
import sys
import time
ready, release = map(Path, sys.argv[1:3])
ready.write_text('fixture ready')
for _ in range(400):
    if release.exists():
        subprocess.run([sys.executable, 'tests/support/fixture-crm.py', *sys.argv[3:]], check=True)
        break
    time.sleep(0.05)
else:
    raise RuntimeError('Fixture gate was not released')
