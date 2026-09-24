import importlib.util
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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

    def test_merge_conflict_opens_issue_and_never_pushes_release(self):
        calls = []

        def fake_run(*args, check=True):
            calls.append(args)
            if args[:3] == ("git", "rev-parse", "upstream-1.46.0^{commit}"):
                return subprocess.CompletedProcess(args, 0, "b" * 40 + "\n", "")
            if args[:3] == ("git", "rev-parse", "HEAD"):
                return subprocess.CompletedProcess(args, 0, "a" * 40 + "\n", "")
            if args[:2] in (("git", "merge-base"), ("git", "ls-remote")):
                return subprocess.CompletedProcess(args, 1, "", "")
            if args[:3] == ("git", "diff", "--name-status"):
                return subprocess.CompletedProcess(args, 0, "M\tlib/mcp/tools/agendamento.ts\n", "")
            if args[:4] == ("git", "diff", "--name-only", "--diff-filter=U"):
                return subprocess.CompletedProcess(args, 0, "lib/mcp/tools/agendamento.ts\n", "")
            if args[:3] == ("git", "diff", "--name-only"):
                return subprocess.CompletedProcess(args, 0, "lib/mcp/tools/agendamento.ts\n", "")
            if args[:2] == ("git", "merge"):
                return subprocess.CompletedProcess(args, 1, "", "merge conflict")
            if args[:3] == ("gh", "issue", "list"):
                return subprocess.CompletedProcess(args, 0, "[]", "")
            if args[:3] == ("gh", "issue", "create"):
                return subprocess.CompletedProcess(args, 0, "issue opened", "")
            if args[:2] in (("git", "push"), ("gh", "pr")):
                raise AssertionError("conflito tentou publicar branch ou abrir PR")
            return subprocess.CompletedProcess(args, 0, "", "")

        def fake_api(path):
            if path.endswith("/releases/latest"):
                return {"tag_name": "v1.46.0"}
            return [{"tag_name": "v1.42.0-mcp", "assets": [{"name": "mcp-release.json"}]}]

        with tempfile.TemporaryDirectory() as directory:
            previous = Path.cwd()
            try:
                os.chdir(directory)
                with patch.object(m, "run", side_effect=fake_run), patch.object(m, "gh_json", side_effect=fake_api):
                    self.assertEqual(m.main(), 2)
                report = Path("mcp-delta-report.md").read_text(encoding="utf-8")
            finally:
                os.chdir(previous)
        self.assertIn("Conflitos — intervenção obrigatória", report)
        self.assertTrue(any(c[:3] == ("gh", "issue", "create") for c in calls))
        self.assertFalse(any(c[:2] == ("git", "push") for c in calls))


if __name__ == "__main__":
    unittest.main()
