import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[2] / "scripts/mcp_manifest.py"
spec = importlib.util.spec_from_file_location("mcp_manifest", path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ManifestTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.digest = "sha256:" + "a" * 64

    def write(self, role):
        (self.directory / f"{role}.metadata.json").write_text(
            json.dumps({"containerimage.digest": self.digest}), encoding="utf-8")

    def build(self, tools=7):
        return m.build_manifest(self.directory, "lucascruzfl", "1.46.0", "b" * 40, tools)

    def test_partial_images_block_manifest(self):
        for role in ("app", "worker", "scheduler"):
            self.write(role)
        with self.assertRaises(FileNotFoundError):
            self.build()

    def test_invalid_digest_blocks_manifest(self):
        for role in m.NAMES:
            self.write(role)
        (self.directory / "worker.metadata.json").write_text(
            json.dumps({"containerimage.digest": "latest"}), encoding="utf-8")
        with self.assertRaises(ValueError):
            self.build()

    def test_four_images_produce_complete_manifest(self):
        for role in m.NAMES:
            self.write(role)
        manifest = self.build()
        self.assertEqual(set(manifest["images"]), set(m.NAMES))
        self.assertEqual(manifest["tag"], "v1.46.0-mcp")
        self.assertEqual(manifest["tool_count_snapshot"], 7)
        self.assertEqual(self.build(tools=232)["tool_count_snapshot"], 232)


if __name__ == "__main__":
    unittest.main()
