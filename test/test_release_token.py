#!/usr/bin/env python3
"""Lock theme.css display version to one token that tracks manifest.json."""

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
THEME = (ROOT / "theme.css").read_text(encoding="utf-8")
PUBLISH = (ROOT / "publish.css").read_text(encoding="utf-8")


class ReleaseTokenTests(unittest.TestCase):
    def test_release_token_tracks_manifest_version(self):
        match = re.search(r"--willemstad-release:\s*([^;]+);", THEME)
        self.assertIsNotNone(match, "theme.css must declare --willemstad-release")
        raw = match.group(1).strip()
        # The value must be a quoted string, not a bare token sequence. It is
        # substituted into `content`, which only accepts <content-list>; an
        # unquoted `v1.11.1 Newfoundland` makes both declarations invalid at
        # computed-value time, so the version text silently disappears. Quoted,
        # the substitution produces two adjacent strings, which concatenate.
        self.assertTrue(
            len(raw) >= 2 and raw[0] == '"' and raw[-1] == '"',
            f"{raw!r} must be a double-quoted string so it stays valid inside content",
        )
        value = raw[1:-1]
        self.assertTrue(
            value.startswith("v" + MANIFEST["version"]),
            f"{value!r} must start with v{MANIFEST['version']}",
        )

    def test_titlebar_and_community_card_use_the_token(self):
        titlebar = re.search(
            r"div\.titlebar-text::after\s*\{[^}]+\}",
            THEME,
        )
        community = re.search(
            r"\.community-item\.mod-active \.community-item-name::after\s*\{[^}]+\}",
            THEME,
        )
        self.assertIsNotNone(titlebar)
        self.assertIsNotNone(community)
        for block in (titlebar.group(0), community.group(0)):
            self.assertIn("var(--willemstad-release)", block)
            self.assertNotIn(MANIFEST["version"], block)

    def test_publish_css_keeps_its_own_release(self):
        header = PUBLISH[:800]
        self.assertIn("v0.5.4 Jordaan", header)
        self.assertNotIn(MANIFEST["version"], header)


if __name__ == "__main__":
    unittest.main()
