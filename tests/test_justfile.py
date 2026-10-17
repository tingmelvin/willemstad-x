"""Public seam: just / launch / drive name just deps when tools are missing."""

from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPERS = ROOT / ".cursor" / "skills" / "verify-willemstad" / "helpers"


def _run_just(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["just", *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )


def _run_helper(name: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(HELPERS / name), *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )


class JustfileDepsNextStepTests(unittest.TestCase):
    def test_just_test_discovers_release_and_harness_suites(self) -> None:
        text = (ROOT / "justfile").read_text(encoding="utf-8")
        self.assertIn("unittest discover -s test -p 'test_*.py' -v", text)
        self.assertIn("unittest discover -s tests -p 'test_*.py' -v", text)

    def test_justfile_guards_missing_verify_tools(self) -> None:
        text = (ROOT / "justfile").read_text(encoding="utf-8")
        self.assertIn("try: just deps", (HELPERS / "deps.sh").read_text(encoding="utf-8"))
        self.assertIn("deps.sh --check", text)
        self.assertIn("just deps", text)

    def test_just_default_targets_ci(self) -> None:
        text = (ROOT / "justfile").read_text(encoding="utf-8")
        self.assertIn("default: ci", text)

    def test_just_check_does_not_require_chrome(self) -> None:
        result = _run_just("check")
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertNotIn("chromium is not installed", result.stderr)

    def test_ci_includes_check_and_all_tests(self) -> None:
        text = (ROOT / "justfile").read_text(encoding="utf-8")
        self.assertIn("ci: check test", text)

    def test_github_actions_runs_canonical_ci_gate(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("actions/checkout@v7", workflow)
        self.assertIn("actions/setup-python@v7", workflow)
        self.assertIn("actions/setup-node@v7", workflow)
        self.assertIn("extractions/setup-just@v4", workflow)
        self.assertIn("just ci", workflow)

    def test_python_bytecode_paths_are_ignored(self) -> None:
        result = subprocess.run(
            [
                "git",
                "check-ignore",
                "test/__pycache__/sample.pyc",
                "tests/__pycache__/sample.pyc",
                ".cursor/skills/verify-willemstad/helpers/__pycache__/serve.pyc",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_launch_without_theme_css_prints_try_deps(self) -> None:
        if (ROOT / "theme.css").is_file():
            self.skipTest("theme.css is checked out")
        result = _run_helper("launch.sh")
        self.assertEqual(result.returncode, 2, result.stderr + result.stdout)
        self.assertIn("error  theme.css is not checked out", result.stderr)
        self.assertIn("try: just deps", result.stderr)
        self.assertNotIn("cannot find theme.css + manifest.json", result.stderr)

    def test_drive_unknown_feature_lists_known_without_theme_css(self) -> None:
        result = _run_helper("drive.sh", "not-a-feature")
        self.assertEqual(result.returncode, 2, result.stderr + result.stdout)
        self.assertIn("unknown feature", result.stderr)
        self.assertIn("Known: reading callouts cssclasses checkboxes focused-mode", result.stderr)
        self.assertNotIn("cannot find theme.css + manifest.json", result.stderr)

    def test_drive_reading_without_theme_css_prints_try_deps(self) -> None:
        if (ROOT / "theme.css").is_file():
            self.skipTest("theme.css is checked out")
        result = _run_helper("drive.sh", "reading")
        self.assertEqual(result.returncode, 2, result.stderr + result.stdout)
        self.assertIn("error  theme.css is not checked out", result.stderr)
        self.assertIn("try: just deps", result.stderr)


if __name__ == "__main__":
    unittest.main()
