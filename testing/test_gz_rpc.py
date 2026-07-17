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

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

try:
    import django
    django.setup()
except Exception:
    pass

from backend.functions.simulate import launch_wsl_ros_command


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
