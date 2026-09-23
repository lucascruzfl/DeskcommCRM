import importlib.util
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[2] / "scripts/mcp_upstream.py"
spec = importlib.util.spec_from_file_location("mcp_upstream", path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class PolicyTest(unittest.TestCase):
    def test_same_version_does_nothing(self):
        self.assertEqual(m.decision("v1.45.0", (1, 45, 0)), "noop")

    def test_newer_version_integrates(self):
        self.assertEqual(m.decision("v1.46.0", (1, 45, 0)), "integrate")

    def test_only_manifest_release_counts_as_ready(self):
        releases = [
            {"tag_name": "v1.46.0-mcp", "assets": []},
            {"tag_name": "v1.45.0-mcp", "assets": [{"name": "mcp-release.json"}]},
            {"tag_name": "v1.99.0", "assets": [{"name": "mcp-release.json"}]},
        ]
        self.assertEqual(m.latest_ready(releases), (1, 45, 0))

    def test_rejects_non_release_tag(self):
        with self.assertRaises(ValueError):
            m.decision("main", None)


if __name__ == "__main__":
    unittest.main()
