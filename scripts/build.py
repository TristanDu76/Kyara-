"""Génère les dossiers et ZIP Chrome / Firefox depuis des sources communes.

Utilisation : python scripts/build.py [--out DOSSIER]
Les ZIP sont non signés ; Firefox Android exige ensuite une signature Mozilla.
"""
import argparse
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ("booster-core.js", "bridge.js", "kyara-plus.js", "panel.css", "service-worker.js")


def build(output: Path) -> None:
    """Écrit uniquement les assets connus et ne supprime aucun fichier existant."""
    base = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    firefox = json.loads((ROOT / "platforms" / "firefox.json").read_text(encoding="utf-8"))
    for target in ("chrome", "firefox"):
        manifest = {**base, **(firefox if target == "firefox" else {})}
        files = {asset: (ROOT / asset).read_bytes() for asset in ASSETS}
        files["manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        folder = output / target
        folder.mkdir(parents=True, exist_ok=True)
        archive = output / f"kyara-plus-{target}-{base['version']}-unsigned.zip"
        with zipfile.ZipFile(archive, "w") as package:
            for name, content in sorted(files.items()):
                (folder / name).write_bytes(content)
                entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                package.writestr(entry, content)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "dist")
    arguments = parser.parse_args()
    build(arguments.out.resolve())
    print(f"Paquets non signés générés dans {arguments.out.resolve()}")
