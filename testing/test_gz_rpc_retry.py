"""Guard: a gz RPC that answers NOTHING is retried; one that answers "no" is not.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_gz_rpc_retry.py -v

Every `gz service` / `gz topic` call in simulate.py is a fresh short-lived
process, and gz-transport's peer discovery either completes inside that process
or does not. When it does not, the CLI **exits 0 and prints nothing**. There is
no error, no stderr, no non-zero status — just an empty stdout where a
"data: true" should be.

The attach path knew this and carried a retry budget; `_ATTACH_MAX_ATTEMPTS`'
own comment measures 2 attempts at ~53% and 10 at 20/20. Nothing else did. So a
place aborted the whole run with

    [SIMULATOR] Command exited 0 but reply was not 'data: true': ...
    [SIMULATOR] stdout:
    [ABORT] Lost track of 'blue tube' after releasing it

on a snap-to-slot whose only fault was an empty reply — observed 2026-09-10,
in a run where two picks had already needed an attach re-roll, so the transport
was visibly flaky at that moment.

THE SPLIT THIS FILE DEFENDS. Empty is not the same as "data: false".

  * empty   -> the service was never reached. Re-rolling the process is the
               only thing that helps, and it is cheap.
  * "false" -> the service was reached and refused (bad SDF, name collision,
               entity not found). Re-asking repeats a decision, and turns a
               fast correct abort into a slow one.

Collapsing the two in either direction is a real regression: retry everything
and a genuine refusal takes seconds to surface; retry nothing and a healthy
world fails a run over a dropped packet.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

try:
    import django
    django.setup()
except Exception:
    pass

from backend.functions import simulate  # noqa: E402


class _Result:
    def __init__(self, stdout="", returncode=0):
        self.stdout = stdout.encode()
        self.stderr = b""
        self.returncode = returncode


def _runs(monkeypatch, *results):
    """Stub subprocess.run with canned results; last one repeats."""
    calls = []
    seq = list(results)

    def fake_run(*a, **kw):
        calls.append(a)
        return seq.pop(0) if len(seq) > 1 else seq[0]

    monkeypatch.setattr(simulate.subprocess, "run", fake_run)
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)
    monkeypatch.setattr(simulate.platform, "system", lambda: "Linux")
    return calls


def test_an_empty_reply_is_retried(monkeypatch):
    """The failure that aborted a run over a dropped packet."""
    calls = _runs(monkeypatch, _Result(""))
    assert simulate.launch_wsl_ros_command("gz service ...", expect_reply_true=True) is False
    assert len(calls) == simulate._GZ_EMPTY_REPLY_RETRIES + 1, (
        f"una risposta vuota ha usato {len(calls)} tentativi invece di "
        f"{simulate._GZ_EMPTY_REPLY_RETRIES + 1}: un RPC che non risponde "
        "non e' un rifiuto, e senza re-roll una run muore per un pacchetto perso."
    )


def test_a_late_reply_wins(monkeypatch):
    """A re-roll that connects must be accepted, and must stop the retries."""
    calls = _runs(monkeypatch, _Result(""), _Result(""), _Result("data: true"))
    assert simulate.launch_wsl_ros_command("gz service ...", expect_reply_true=True) is True
    assert len(calls) == 3, "ha continuato a riprovare dopo una risposta valida"


def test_an_explicit_refusal_is_not_retried(monkeypatch):
    """"data: false" means the service answered. Re-asking repeats a decision."""
    calls = _runs(monkeypatch, _Result("data: false"))
    assert simulate.launch_wsl_ros_command("gz service ...", expect_reply_true=True) is False
    assert len(calls) == 1, (
        f"un rifiuto esplicito e' stato ritentato {len(calls)} volte: "
        "trasforma un abort corretto e immediato in uno lento, e non puo' "
        "cambiare esito perche' il servizio ha gia' risposto."
    )


def test_a_nonzero_exit_is_not_retried(monkeypatch):
    """A command that failed to run is not a discovery problem."""
    calls = _runs(monkeypatch, _Result("", returncode=1))
    assert simulate.launch_wsl_ros_command("gz service ...", expect_reply_true=True) is False
    assert len(calls) == 1


def test_a_first_time_success_costs_one_call(monkeypatch):
    calls = _runs(monkeypatch, _Result("data: true"))
    assert simulate.launch_wsl_ros_command("gz service ...", expect_reply_true=True) is True
    assert len(calls) == 1


def test_calls_without_expect_reply_true_are_unaffected(monkeypatch):
    """Only Boolean-reply RPCs have a reply to be missing.

    `gz topic -p` and friends have no reply to check, so an empty stdout is
    their normal output and must not trigger a re-roll.
    """
    calls = _runs(monkeypatch, _Result(""))
    assert simulate.launch_wsl_ros_command("gz topic -p ...") is True
    assert len(calls) == 1


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
