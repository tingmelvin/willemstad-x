"""Security and lifecycle contracts for the isolated verifier helpers."""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPERS = ROOT / ".cursor" / "skills" / "verify-willemstad" / "helpers"
LIB = HELPERS / "lib.sh"


def _metadata(pid: int, pid_start: str, repo_root: str | None = None) -> str:
    return "\n".join(
        (
            "VERIFY_BIND=127.0.0.1",
            "VERIFY_PORT=47821",
            f"VERIFY_PID={pid}",
            f"VERIFY_PID_START={pid_start}",
            "VERIFY_BASE_URL=http://127.0.0.1:47821",
            f"VERIFY_REPO_ROOT={repo_root or ROOT}",
            f"VERIFY_SKILL_DIR={HELPERS.parent}",
            "VERIFY_MANIFEST_VERSION=1.11.1",
            "VERIFY_THEME_CSS_VERSION=1.11.1",
            "",
        )
    )


class VerifierSafetyTests(unittest.TestCase):
    def test_metadata_values_are_parsed_without_shell_execution(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            marker = run_dir / "executed"
            payload = f"$(printf owned > {shlex.quote(str(marker))})"
            (run_dir / "meta.env").write_text(
                _metadata(999999, payload),
                encoding="utf-8",
            )
            env = os.environ | {"VERIFY_RUN_DIR": str(run_dir)}
            result = subprocess.run(
                [
                    "bash",
                    "-c",
                    "source \"$1\"; load_run_meta; printf '%s\\n' \"$VERIFY_PID_START\"",
                    "bash",
                    str(LIB),
                ],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertEqual(result.stdout.strip(), payload)
            self.assertFalse(marker.exists(), "metadata command substitution executed")

    def test_metadata_rejects_malformed_unknown_and_duplicate_keys(self) -> None:
        cases = {
            "malformed": ("not-an-assignment\n", "malformed metadata line"),
            "unknown": ("UNKNOWN=value\n", "unknown metadata key UNKNOWN"),
            "duplicate": ("VERIFY_PID=1\n", "duplicate metadata key VERIFY_PID"),
        }
        for name, (suffix, expected) in cases.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                run_dir = Path(tmp)
                (run_dir / "meta.env").write_text(
                    _metadata(999999, "not-running") + suffix,
                    encoding="utf-8",
                )
                result = subprocess.run(
                    ["bash", "-c", 'source "$1"; load_run_meta', "bash", str(LIB)],
                    cwd=ROOT,
                    env=os.environ | {"VERIFY_RUN_DIR": str(run_dir)},
                    capture_output=True,
                    text=True,
                )
                self.assertNotEqual(result.returncode, 0, result.stderr + result.stdout)
                self.assertIn(expected, result.stderr)

    def test_cleanup_refuses_an_unrelated_live_pid(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            process = subprocess.Popen(["sleep", "60"])
            try:
                (run_dir / "server.pid").write_text(f"{process.pid}\n", encoding="utf-8")
                (run_dir / "meta.env").write_text(
                    _metadata(process.pid, "not-the-real-start-time"),
                    encoding="utf-8",
                )
                result = subprocess.run(
                    [str(HELPERS / "cleanup.sh")],
                    cwd=ROOT,
                    env=os.environ
                    | {
                        "VERIFY_RUN_DIR": str(run_dir),
                        "VERIFY_EVIDENCE_DIR": str(run_dir / "evidence"),
                    },
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(result.returncode, 3, result.stderr + result.stdout)
                self.assertIsNone(process.poll(), "cleanup killed an unrelated process")
                self.assertIn("refuse to signal", result.stderr)
            finally:
                process.terminate()
                process.wait(timeout=5)

    def test_evidence_directories_are_atomically_unique(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            evidence = Path(tmp) / "evidence"
            result = subprocess.run(
                [
                    "bash",
                    "-c",
                    "source \"$1\"; a=$(new_evidence_dir reading 20260929T120000Z); "
                    "b=$(new_evidence_dir reading 20260929T120000Z); "
                    "printf '%s\\n%s\\n' \"$a\" \"$b\"",
                    "bash",
                    str(LIB),
                ],
                cwd=ROOT,
                env=os.environ | {"VERIFY_EVIDENCE_DIR": str(evidence)},
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            first, second = map(Path, result.stdout.splitlines())
            self.assertNotEqual(first, second)
            self.assertTrue(first.is_dir())
            self.assertTrue(second.is_dir())

    def test_chrome_sandbox_is_disabled_only_by_explicit_opt_in(self) -> None:
        module = (HELPERS / "chrome-args.mjs").as_uri()
        script = f"""
import {{ buildChromeArgs }} from {json.dumps(module)};
const normal = buildChromeArgs({{ userData: '/tmp/profile', port: 9222 }});
const optedOut = buildChromeArgs({{ userData: '/tmp/profile', port: 9222, allowNoSandbox: true }});
console.log(JSON.stringify({{ normal, optedOut }}));
"""
        result = subprocess.run(
            ["node", "--input-type=module", "--eval", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        args = json.loads(result.stdout)
        self.assertNotIn("--no-sandbox", args["normal"])
        self.assertIn("--no-sandbox", args["optedOut"])

    def test_resolved_cdp_operations_do_not_keep_node_alive(self) -> None:
        module = (HELPERS / "cdp.mjs").as_uri()
        script = f"""
import {{ Cdp }} from {json.dumps(module)};
class FakeWs {{
  constructor() {{ this.listeners = {{}}; }}
  addEventListener(name, listener) {{ this.listeners[name] = listener; }}
  send(raw) {{
    const message = JSON.parse(raw);
    queueMicrotask(() => this.listeners.message({{ data: JSON.stringify({{ id: message.id, result: {{ ok: true }} }}) }}));
  }}
  event(method, params = {{}}) {{
    this.listeners.message({{ data: JSON.stringify({{ method, params }}) }});
  }}
}}
const ws = new FakeWs();
const cdp = new Cdp(ws);
await cdp.send('Runtime.enable');
const loaded = cdp.once('Page.loadEventFired', null, 1000);
queueMicrotask(() => ws.event('Page.loadEventFired'));
await loaded;
if (cdp.pending.size !== 0 || cdp.events.length !== 0) process.exit(2);
"""
        result = subprocess.run(
            ["node", "--input-type=module", "--eval", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=2,
        )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)


if __name__ == "__main__":
    unittest.main()
