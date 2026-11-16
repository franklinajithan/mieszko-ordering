"""Exercise the Linux bootstrap without package installs, network, CRM or a database."""
import hashlib
import io
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest


SETUP = Path(__file__).resolve().parents[1] / 'setup-linux-worker.sh'


class LinuxPreparationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.app = self.root / 'app'
        (self.app / 'automation').mkdir(parents=True)
        shutil.copy(SETUP, self.app / 'automation/setup-linux-worker.sh')
        (self.app / 'automation/requirements.txt').write_text('playwright\n')
        (self.app / 'package-lock.json').write_text('{}')
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.log = self.root / 'calls'
        self.env = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}',
                        TEST_CALLS=str(self.log), TEST_ROOT=str(self.root), REAL_PYTHON=sys.executable)
        self.executable('uname', '#!/bin/sh\necho x86_64\n')
        self.executable('python3', '''#!/bin/bash
if [[ "$1" == '-m' && "$2" == 'venv' ]]; then
  mkdir -p "$3/bin"
  cp "$0" "$3/bin/python"
elif [[ "$1" == '-m' ]]; then
  echo "python $*" >> "$TEST_CALLS"
elif [[ "$1" == '-' ]]; then
  cat >/dev/null
  echo browser-smoke >> "$TEST_CALLS"
  exit "${TEST_BROWSER_EXIT:-0}"
else
  exec "$REAL_PYTHON" "$@"
fi
''')
        archive = self.root / 'node.tar.xz'
        with tarfile.open(archive, 'w:xz') as tar:
            for name, body in {
                'node': '#!/bin/sh\necho node-isolated >> "$TEST_CALLS"\n',
                'npm': '#!/bin/sh\necho "npm $*" >> "$TEST_CALLS"\n',
            }.items():
                payload = body.encode()
                item = tarfile.TarInfo(f'node-v22.23.3-linux-x64/bin/{name}')
                item.size = len(payload)
                item.mode = 0o755
                tar.addfile(item, io.BytesIO(payload))
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        (self.root / 'manifest').write_text(f'{digest}  node-v22.23.3-linux-x64.tar.xz\n')
        self.executable('curl', '''#!/bin/bash
url=''
while (($#)); do
  if [[ "$1" == '-o' ]]; then out="$2"; shift 2; else
    [[ "$1" == https://* ]] && url="$1"
    shift
  fi
done
echo download >> "$TEST_CALLS"
if [[ "$url" == */SHASUMS256.txt ]]; then
  cp "$TEST_ROOT/manifest" "$out"
else
  cp "$TEST_ROOT/node.tar.xz" "$out"
fi
''')

    def executable(self, name, content):
        path = self.bin / name
        path.write_text(content)
        path.chmod(0o755)

    def run_setup(self):
        return subprocess.run(['bash', str(self.app / 'automation/setup-linux-worker.sh')],
                              env=self.env, text=True, capture_output=True, timeout=20)

    def calls(self):
        return self.log.read_text() if self.log.exists() else ''

    def test_prepares_isolated_runtime_and_local_browser_without_activating(self):
        result = self.run_setup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('PREPARED ONLY', result.stdout)
        self.assertIn('npm ci --ignore-scripts', self.calls())
        self.assertIn('browser-smoke', self.calls())
        self.assertNotIn('worker.py', self.calls())
        self.assertNotIn('systemctl', self.calls())
        self.assertTrue((self.app / '.worker-runtime/node/bin/node').exists())
        self.assertFalse((self.app / '.env').exists())

    def test_checksum_mismatch_stops_before_any_dependency_execution(self):
        (self.root / 'manifest').write_text('0' * 64 + '  node-v22.23.3-linux-x64.tar.xz\n')
        result = self.run_setup()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('npm ', self.calls())
        self.assertFalse((self.app / '.worker-runtime/node').exists())

    def test_missing_source_stops_before_download(self):
        (self.app / 'package-lock.json').unlink()
        result = self.run_setup()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls(), '')

    def test_browser_failure_does_not_report_readiness(self):
        self.env['TEST_BROWSER_EXIT'] = '1'
        result = self.run_setup()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('PREPARED ONLY', result.stdout)
        self.assertIn('PREPARATION FAILED', result.stderr)

    def test_retry_reuses_node_download(self):
        self.assertEqual(self.run_setup().returncode, 0)
        before = self.calls().count('download\n')
        self.assertEqual(self.run_setup().returncode, 0)
        self.assertEqual(self.calls().count('download\n'), before)

    def test_windows_line_endings_are_repaired_before_execution(self):
        script = self.app / 'automation/setup-linux-worker.sh'
        script.write_bytes(script.read_bytes().replace(b'\n', b'\r\n'))
        failed = self.run_setup()
        self.assertNotEqual(failed.returncode, 0)
        self.assertEqual(self.calls(), '')
        # Same server-side conversion used by the Windows launcher.
        subprocess.run(['sed', '-i', r's/\r$//', str(script)], check=True)
        repaired = self.run_setup()
        self.assertEqual(repaired.returncode, 0, repaired.stderr)
        self.assertIn('PREPARED ONLY', repaired.stdout)

    def test_windows_git_archive_preserves_unix_shell_line_endings(self):
        archive = subprocess.check_output([
            'git', '-c', 'core.autocrlf=true', 'archive', '--worktree-attributes',
            'HEAD', 'automation/setup-linux-worker.sh',
        ], cwd=SETUP.parents[1])
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            body = tar.extractfile('automation/setup-linux-worker.sh').read()
        self.assertNotIn(b'\r\n', body)


if __name__ == '__main__':
    unittest.main()
