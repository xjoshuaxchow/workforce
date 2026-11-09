import importlib.util
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('installer', pathlib.Path(__file__).resolve().parents[1] / 'scripts/install-local-tts.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

class SeedIdentityTest(unittest.TestCase):
    def test_same_size_seed_must_match_upstream_git_blob(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'tokens.txt'
            info = {'size': 6, 'oid': 'ce013625030ba8dba906f756967f9e9ca394464a'}
            path.write_bytes(b'hello\n')
            self.assertTrue(installer.matches_model_file(path, info))
            path.write_bytes(b'jello\n')
            self.assertFalse(installer.matches_model_file(path, info))

if __name__ == '__main__':
    unittest.main()
