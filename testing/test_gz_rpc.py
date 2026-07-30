"""launch_wsl_ros_command Boolean-RPC reply verification (offline, no Gazebo).

Run:
    poetry run python -m pytest testing/test_gz_rpc.py -v

gz service --reptype gz.msgs.Boolean calls exit 0 even when the service
replies "data: false" (bad SDF, name collision, entity not found) — exit
code alone can't distinguish that from a real success. expect_reply_true
closes that gap by requiring "data: true" in stdout too.
"""
import sys
import os
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

try:
    import django
    django.setup()
except Exception:
    pass

import subprocess

from backend.functions.simulate import launch_wsl_ros_command, _safe_gz_entity_name


def _mock_result(returncode, stdout=b""):
    r = MagicMock()
    r.returncode = returncode
    r.stdout = stdout
    r.stderr = b""
    return r


def test_rc0_reply_true_passes():
    with patch("backend.functions.simulate.subprocess.run",
               return_value=_mock_result(0, b"data: true\n\n")):
        assert launch_wsl_ros_command("gz service ...", expect_reply_true=True) is True


def test_rc0_reply_false_fails():
    with patch("backend.functions.simulate.subprocess.run",
               return_value=_mock_result(0, b"data: false\n\n")):
        assert launch_wsl_ros_command("gz service ...", expect_reply_true=True) is False


def test_rc0_no_expectation_passes_regardless_of_reply():
    with patch("backend.functions.simulate.subprocess.run",
               return_value=_mock_result(0, b"data: false\n\n")):
        assert launch_wsl_ros_command("gz service ...") is True


def test_rc_nonzero_fails():
    with patch("backend.functions.simulate.subprocess.run",
               return_value=_mock_result(1, b"data: true\n\n")):
        assert launch_wsl_ros_command("gz service ...", expect_reply_true=True) is False


def test_hung_subprocess_times_out_instead_of_blocking_forever():
    """W3.3: every subprocess.run call must carry an explicit timeout — before
    this, a hung `gz`/`wsl` process blocked the request thread AND
    _SIM_RUN_LOCK forever, so no later run could ever start."""
    with patch("backend.functions.simulate.subprocess.run",
               side_effect=subprocess.TimeoutExpired(cmd="gz ...", timeout=8)):
        assert launch_wsl_ros_command("gz service ...") is False


def test_subprocess_run_called_with_explicit_timeout():
    with patch("backend.functions.simulate.subprocess.run",
               return_value=_mock_result(0, b"")) as mock_run:
        launch_wsl_ros_command("gz service ...")
    assert mock_run.call_args.kwargs.get("timeout") is not None


# ── _safe_gz_entity_name: shell-injection / path-traversal guard (W3.1) ─────
# Object/location names come from DB tables the operator can edit and are
# interpolated, after normalization, into a `bash -c "gz ... --req '...name:
# \"{name}\"...'"` string (and, elsewhere, an os.path.join for the SDF file).
# A name containing a quote/`;`/`$()`/`..` must never reach either.

def test_safe_gz_entity_name_accepts_normal_names():
    assert _safe_gz_entity_name("tube") == "tube"
    assert _safe_gz_entity_name("Blue Flask") == "blue_flask"


@pytest.mark.parametrize("dangerous_name", [
    "tube'; rm -rf / #",
    'tube"; touch /tmp/pwned; echo "',
    "$(reboot)",
    "tube`id`",
    "../../etc/passwd",
    "../secret",
])
def test_safe_gz_entity_name_rejects_shell_metacharacters(dangerous_name):
    assert _safe_gz_entity_name(dangerous_name) is None


def test_safe_gz_entity_name_rejects_empty_and_none():
    assert _safe_gz_entity_name("") is None
    assert _safe_gz_entity_name(None) is None
