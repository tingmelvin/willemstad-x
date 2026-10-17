#!/usr/bin/env python3
"""Lock current theme minAppVersion to manifest.json."""

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
VERSIONS = json.loads((ROOT / "versions.json").read_text(encoding="utf-8"))
README = (ROOT / "README.md").read_text(encoding="utf-8")
GITATTRIBUTES = (ROOT / ".gitattributes").read_text(encoding="utf-8")


class MinAppVersionsTests(unittest.TestCase):
    def test_current_versions_entry_copies_manifest_min_app(self):
        version = MANIFEST["version"]
        min_app = MANIFEST["minAppVersion"]
        self.assertIn(version, VERSIONS)
        self.assertEqual(
            VERSIONS[version],
            min_app,
            f"versions.json[{version!r}] must copy manifest minAppVersion {min_app!r}",
        )

    def test_readme_names_live_and_archive_css(self):
        self.assertRegex(
            README,
            re.compile(r"theme\.css.+manifest\.json|manifest\.json.+theme\.css", re.S),
        )
        self.assertRegex(
            README, r"publish\.css.+\bPublish\b|\bPublish\b.+publish\.css"
        )
        self.assertRegex(
            README,
            re.compile(
                r"obsidian\.css.+(historical|archive|not the (current|live))",
                re.I,
            ),
        )

    def test_gitattributes_drops_missing_source_paths(self):
        # `linguist-vendored` tells GitHub to leave a path out of language stats.
        # Upstream accumulated several such rules for trees that were later
        # deleted, and a rule pointing at nothing is dead config.
        #
        # Only *rules* count here. A comment explaining which rules were removed
        # legitimately names the paths it is talking about.
        rules = "\n".join(
            line
            for line in GITATTRIBUTES.splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        )

        for stale in ("src/Z-NonTheme", "build/", "snippet.css"):
            self.assertNotIn(stale, rules)

        # Do not check the bare substring "src/": this fork has a real src/ tree
        # now — the modular source that theme.css is built from — so forbidding
        # the substring would also forbid a legitimate `eol` rule for it.
        #
        # Every `linguist-vendored` rule that remains must actually resolve.
        local_only = {"archive", "old", "V1.9"}  # kept out of git on purpose
        for line in rules.splitlines():
            parts = line.split()
            if len(parts) < 2 or "linguist-vendored" not in parts:
                continue
            base = parts[0].split("*")[0].rstrip("/")
            if not base or base in local_only:
                continue
            self.assertTrue(
                (ROOT / base).exists(),
                f".gitattributes suppresses language stats for missing path {parts[0]!r}",
            )


if __name__ == "__main__":
    unittest.main()
