import importlib.util
import os
import tempfile
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
            {"tag_name": "v1.47.0-mcp", "draft": True, "assets": [{"name": "mcp-release.json"}]},
            {"tag_name": "v1.45.0-mcp", "assets": [{"name": "mcp-release.json"}]},
            {"tag_name": "v1.99.0", "assets": [{"name": "mcp-release.json"}]},
        ]
        self.assertEqual(m.latest_ready(releases), (1, 45, 0))

    def test_rejects_non_release_tag(self):
        with self.assertRaises(ValueError):
            m.decision("main", None)

    def test_delta_report_lists_route_status_and_contracts(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = Path.cwd()
            try:
                os.chdir(directory)
                m.report("1.46.0", "v1.45.0", "a" * 40, "b" * 40,
                         ["app/api/v1/example/route.ts", "lib/mcp/registry.ts", "lib/foo/schema.ts"],
                         [], [("A", "app/api/v1/example/route.ts")])
                content = Path("mcp-delta-report.md").read_text(encoding="utf-8")
            finally:
                os.chdir(previous)
        self.assertIn("`A` `app/api/v1/example/route.ts`", content)
        self.assertIn("Contratos, schemas e tipos (1)", content)


if __name__ == "__main__":
    unittest.main()
