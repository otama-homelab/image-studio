import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest

WORKFLOW=Path(__file__).parents[1]/'.github/workflows/version-bump.yaml'

class ReleaseVersionTests(unittest.TestCase):
    def run_bump(self,bump,package_version='1.1.2'):
        script=WORKFLOW.read_text().split("python - <<'PY'\n",1)[1].split('\n          PY',1)[0]
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'web').mkdir();(root/'VERSION').write_text('1.1.2\n')
            package={'version':package_version};lock={'version':package_version,'packages':{'':{'version':package_version},'node_modules/dependency':{'version':'9.9.9'}}}
            for name,data in [('package.json',package),('package-lock.json',lock)]:
                (root/'web'/name).write_text(json.dumps(data))
            result=subprocess.run([sys.executable,'-c',textwrap.dedent(script)],cwd=root,env={**os.environ,'BUMP':bump,'GITHUB_OUTPUT':str(root/'output')},capture_output=True,text=True)
            return result,(root/'VERSION').read_text().strip(),json.loads((root/'web/package.json').read_text()),json.loads((root/'web/package-lock.json').read_text())

    def test_release_updates_all_metadata_and_preserves_dependency_versions(self):
        for bump,expected in [('patch','1.1.3'),('minor','1.2.0'),('major','2.0.0')]:
            with self.subTest(bump=bump):
                result,version,package,lock=self.run_bump(bump)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual([version,package['version'],lock['version'],lock['packages']['']['version']],[expected]*4)
                self.assertEqual(lock['packages']['node_modules/dependency']['version'],'9.9.9')

    def test_mismatch_is_rejected_before_any_version_write(self):
        result,version,package,lock=self.run_bump('patch','0.1.0')
        self.assertNotEqual(result.returncode,0);self.assertEqual(version,'1.1.2')
        self.assertEqual(package['version'],'0.1.0');self.assertEqual(lock['version'],'0.1.0')

if __name__=='__main__':unittest.main()
