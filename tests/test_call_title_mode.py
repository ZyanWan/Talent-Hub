from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from app.call_repository import CallRepository


class CallTitleModeTests(unittest.TestCase):
    def test_repository_persists_automatic_and_custom_titles(self):
        with TemporaryDirectory() as temp_dir:
            repository = CallRepository(Path(temp_dir))

            automatic = repository.create()
            custom = repository.create("本周候选人回访", title_mode="custom")

            self.assertEqual(automatic["title_mode"], "auto")
            self.assertRegex(automatic["title"], r"^\d{4}-\d{2}-\d{2} 电话确认$")
            self.assertEqual(custom["title_mode"], "custom")
            self.assertEqual(custom["title"], "本周候选人回访")


if __name__ == "__main__":
    unittest.main()
