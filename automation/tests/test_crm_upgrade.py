"""Ensure the explicit office upgrade cannot run after a failed backup/check."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class CrmUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        (root / 'automation').mkdir()
        (root / 'migrations/manual').mkdir(parents=True)
        repo = Path(__file__).resolve().parents[2]
        self.script = root / 'automation/apply-crm-settings-upgrade.sh'
        shutil.copy(repo / 'automation/apply-crm-settings-upgrade.sh', self.script)
        shutil.copy(repo / 'migrations/manual/2026-10-16-crm-store-settings.sql', root / 'migrations/manual')
        binary = root / 'bin'
        binary.mkdir()
        self.log = root / 'calls'
        self.env = dict(os.environ, PATH=str(binary) + ':' + os.environ['PATH'],
                        TEST_CALLS=str(self.log), MIESZKO_DB_BACKUP_DIRECTORY=str(root / 'backups'))
        commands = {
            'sudo': '#!/bin/sh\nshift 2\nexec "$@"\n',
            'pg_dump': '#!/bin/sh\necho dump >> "$TEST_CALLS"\necho fixture-archive\nexit "${TEST_DUMP_EXIT:-0}"\n',
            'pg_restore': '#!/bin/sh\necho archive-check >> "$TEST_CALLS"\nexit "${TEST_ARCHIVE_EXIT:-0}"\n',
            'psql': '#!/bin/sh\necho apply >> "$TEST_CALLS"\ncat >/dev/null\n',
        }
        for name, body in commands.items():
            path = binary / name
            path.write_text(body)
            path.chmod(0o755)

    def run_upgrade(self):
        return subprocess.run(['bash', str(self.script)], env=self.env, text=True, capture_output=True, timeout=10)

    def test_upgrade_runs_only_after_successful_dump_and_archive_check(self):
        result = self.run_upgrade()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.log.read_text().splitlines(), ['dump','archive-check','apply'])
        self.assertIn('upgrade complete', result.stdout)

    def test_dump_failure_never_reaches_migration(self):
        self.env['TEST_DUMP_EXIT'] = '1'
        result = self.run_upgrade()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.log.read_text().splitlines(), ['dump'])

    def test_bad_archive_never_reaches_migration(self):
        self.env['TEST_ARCHIVE_EXIT'] = '1'
        result = self.run_upgrade()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.log.read_text().splitlines(), ['dump','archive-check'])


if __name__ == '__main__': unittest.main()
