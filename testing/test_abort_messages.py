"""Static regression test: every `_abort_task` operator-facing reason must be
plain language, never engineering jargon (offline, no imports of simulate.py
needed beyond reading its source — this is a source-level check, not a
runtime one).

Run:
    poetry run python -m pytest testing/test_abort_messages.py -v

`_abort_task(reason)` sends `reason` verbatim to the operator's robot panel
(`DigitalTwinPanel.tsx`'s persistent error banner) — but roughly half the
~24 call sites used to read like log lines (`"pick FK guard: pos_err=12.3mm
> 5mm"`, `"place snap-to-slot failed (set_pose)"`, two of them even passed
the raw Python exception straight through). Operators aren't developers and
shouldn't have to parse engineering shorthand to know what happened. All
call sites were rewritten to `_abort_task(reason, detail=...)` — `reason`
plain language (what happened + what to do), `detail` technical (log-only,
never sent to the frontend). This test parses `simulate.py`'s AST, extracts
every `_abort_task` call's first (reason) argument's literal text —
skipping the interpolated `{...}` parts of f-strings, since those hold
runtime object names, not fixed vocabulary — and asserts none of them
contain engineering jargon. It does not check `detail=` (technical language
is correct there by design).
"""
import ast
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SIMULATE_PY = os.path.join(
    os.path.dirname(__file__), "..", "backend", "functions", "simulate.py"
)

# Vocabulary a non-programmer, non-robotics operator would not understand,
# found in the pre-fix abort reasons and removed from `reason` text.
BANNED_TERMS = [
    "ik ", "ik failed", " ik", "fk guard", "fk ", "tcp", "detachablejoint",
    "set_pose", "pos_err", "z_carry", "z_pick", "z_place", "z_up",
    "encoders", "twin divergence", "snap-to-slot", "snap-to-tcp",
    "post-spawn", "recursion", "cycle detection", "publish time",
    "sdf", "hand_close", "hand_only", "joint state", "curjnt",
    "handcurpos", "gz service", "rpc",
]


def _literal_text(node: ast.AST) -> str:
    """Concatenate the literal (non-interpolated) string parts of a
    Constant or f-string (JoinedStr) AST node. Interpolated {expr} parts
    (FormattedValue) are skipped — they hold runtime values (object/location
    names), not fixed vocabulary, so they're not checked against the banned
    list."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        return "".join(
            part.value for part in node.values if isinstance(part, ast.Constant)
        )
    return ""


def _extract_abort_task_reasons():
    """Return a list of (lineno, reason_text) for every _abort_task(...) call
    in simulate.py, using the first positional argument as `reason`."""
    src = open(SIMULATE_PY, encoding="utf-8").read()
    tree = ast.parse(src, filename=SIMULATE_PY)
    reasons = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "_abort_task"
        ):
            if not node.args:
                continue  # the def itself / a bare re-raise pattern, not a real call
            reasons.append((node.lineno, _literal_text(node.args[0])))
    return reasons


def test_at_least_twenty_abort_call_sites_are_checked():
    """Sanity check that the AST walk actually found the call sites — a
    silently-empty list would make every test below vacuously pass."""
    reasons = _extract_abort_task_reasons()
    assert len(reasons) >= 20


@pytest.mark.parametrize("term", BANNED_TERMS)
def test_no_abort_reason_contains_engineering_jargon(term):
    reasons = _extract_abort_task_reasons()
    offenders = [
        (lineno, text) for lineno, text in reasons if term in text.lower()
    ]
    assert offenders == [], (
        f"_abort_task reason(s) contain banned term {term!r}: {offenders}"
    )


def test_no_abort_reason_passes_a_raw_exception_through():
    """Regression: two call sites used to be `_abort_task(f"... failed: {e}")`
    — a bare exception object interpolated directly into operator-facing
    text, worst case a raw stack-frame string. `detail=f"...: {e}"` is fine
    (log-only); `reason` must never end with a raw `{e}`/`{exc}`/`{error}`
    interpolation as its only dynamic content."""
    src = open(SIMULATE_PY, encoding="utf-8").read()
    tree = ast.parse(src, filename=SIMULATE_PY)
    offenders = []
    for node in ast.walk(tree):
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "_abort_task"
            and node.args
        ):
            continue
        reason_node = node.args[0]
        if not isinstance(reason_node, ast.JoinedStr):
            continue
        for part in reason_node.values:
            if isinstance(part, ast.FormattedValue) and isinstance(part.value, ast.Name):
                if part.value.id in ("e", "exc", "error", "err"):
                    offenders.append((node.lineno, part.value.id))
    assert offenders == [], f"raw exception interpolated into reason: {offenders}"


def test_abort_task_signature_has_reason_and_detail():
    """Pins the `_abort_task(reason, detail=None)` split itself — if this
    signature ever collapses back to a single argument, the two tests above
    would stop being meaningful (they'd just be checking the log-only string)."""
    src = open(SIMULATE_PY, encoding="utf-8").read()
    match = re.search(r"def _abort_task\(([^)]*)\)", src)
    assert match is not None
    sig = match.group(1)
    assert "reason" in sig
    assert "detail" in sig


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
