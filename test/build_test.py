"""Vérification des deux paquets depuis les mêmes sources, sans dépendance."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build", ROOT / "scripts" / "build.py")
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class BuildTests(unittest.TestCase):
    def test_packages_share_runtime_and_version(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            BUILD.build(output)
            base = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
            manifests = {}
            for target in ("chrome", "firefox"):
                folder = output / target
                manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
                manifests[target] = manifest
                self.assertEqual(manifest["version"], base["version"])
                self.assertEqual(manifest["permissions"], base["permissions"])
                self.assertEqual(manifest["content_scripts"], base["content_scripts"])
                archive = output / f"kyara-plus-{target}-{base['version']}-unsigned.zip"
                with zipfile.ZipFile(archive) as package:
                    self.assertIsNone(package.testzip())
                    self.assertEqual(set(package.namelist()), {"manifest.json", *BUILD.ASSETS})
                    self.assertEqual(json.loads(package.read("manifest.json")), manifest)
                    for asset in BUILD.ASSETS:
                        self.assertEqual(package.read(asset), (ROOT / asset).read_bytes())
                        self.assertEqual((folder / asset).read_bytes(), (ROOT / asset).read_bytes())
            self.assertEqual(manifests["chrome"], base)
            firefox = manifests["firefox"]
            self.assertNotIn("service_worker", firefox["background"])
            self.assertEqual(firefox["background"], {"scripts": ["service-worker.js"]})
            settings = firefox["browser_specific_settings"]
            self.assertEqual(settings["gecko_android"]["strict_min_version"], "142.0")
            self.assertTrue(settings["gecko"]["id"])
            self.assertEqual(settings["gecko"]["data_collection_permissions"]["required"], ["none"])

    def test_build_is_repeatable_and_preserves_unrelated_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            sentinel = output / "user.txt"
            sentinel.write_text("conserver", encoding="utf-8")
            BUILD.build(output)
            before = {archive.name: archive.read_bytes() for archive in output.glob("*.zip")}
            BUILD.build(output)
            self.assertEqual(before, {archive.name: archive.read_bytes() for archive in output.glob("*.zip")})
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "conserver")


if __name__ == "__main__":
    unittest.main()
