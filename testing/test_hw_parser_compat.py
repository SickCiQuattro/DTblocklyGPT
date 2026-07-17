"""Hardware parser compatibility tests (dry-run, no BCAP required).

Run:
    DJANGO_SETTINGS_MODULE=django_project_conf.settings poetry run python -m pytest testing/test_hw_parser_compat.py -v

Each test builds a synthetic Blockly JSON block tree and runs it through
hardware_recursive_blockly_parser with a mock HWContext that records all
BCAP calls without executing real hardware.

Assertions per test:
1. BCAP call sequence  — ctx.client.robot_move call count / order
2. Gripper events      — ctx.ctrl.Execute call count (HAND_MOVE_A = open, HAND_MOVE_H = close)
3. Return code         — no exception raised (or specific exception type on error paths)
4. Block execution trace — per-block print output captured via capsys
"""
import sys
import os
import json
import threading
import pytest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

try:
    import django
    django.setup()
except Exception:
    pass

from backend.functions.task import hardware_recursive_blockly_parser


# ── Fixtures ──────────────────────────────────────────────────────────────────

def make_ctx():
    ctx = MagicMock()
    ctx.stop_event = threading.Event()
    return ctx


def make_qs(items):
    qs = MagicMock()
    def _filter(**kwargs):
        result = MagicMock()
        id_val = kwargs.get("id")
        found = next((x for x in items if getattr(x, "id", None) == id_val), None)
        result.first.return_value = found
        return result
    qs.filter.side_effect = _filter
    return qs


def mock_obj(obj_id=1, name="flask"):
    o = MagicMock()
    o.id = obj_id
    o.name = name
    o.height = 0.1
    o.force = 2
    o.points = None
    return o


def mock_loc(loc_id=10, name="tray"):
    loc = MagicMock()
    loc.id = loc_id
    loc.name = name
    loc.position = json.dumps(
        {"X": 100.0, "Y": 200.0, "Z": 300.0, "RX": 180.0, "RY": 0.0, "RZ": 180.0, "FIG": 261.0}
    )
    return loc


def mock_action(act_id=5, name="stir"):
    a = MagicMock()
    a.id = act_id
    a.name = name
    a.points = json.dumps(
        {"points": ['{"X": 10, "Y": 20, "Z": 30, "RX": 0, "RY": 0, "RZ": 0, "FIG": 0}']}
    )
    return a


def _pick_block(obj_id=1, obj_name="flask", next_block=None):
    b = {
        "type": "pick_block",
        "inputs": {
            "OBJECT": {"block": {"data": json.dumps({"id": obj_id, "name": obj_name})}}
        },
    }
    if next_block:
        b["next"] = {"block": next_block}
    return b


def _place_block(loc_id=10, loc_name="tray"):
    return {
        "type": "place_block",
        "inputs": {
            "LOCATION": {"block": {"data": json.dumps({"id": loc_id, "name": loc_name})}}
        },
    }


def _processing_block(act_id=5, act_name="stir", next_block=None):
    b = {
        "type": "processing_block",
        "inputs": {
            "ACTION": {"block": {"data": json.dumps({"id": act_id, "name": act_name})}}
        },
    }
    if next_block:
        b["next"] = {"block": next_block}
    return b


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestRepeatPickPlace:
    """repeat(2, pick→place) — BCAP call sequence and gripper events."""

    def test_bcap_call_count(self):
        code = {
            "type": "repeat_block",
            "fields": {"times": "2"},
            "inputs": {
                "DO": {"block": _pick_block(next_block=_place_block())}
            },
        }
        ctx = make_ctx()
        obj_qs = make_qs([mock_obj()])
        loc_qs = make_qs([mock_loc()])
        act_qs = make_qs([])

        with patch("backend.functions.task.search_object", return_value=(True, 0)) as mock_search, \
             patch("backend.functions.task.robot_getvar", return_value=[100.0, 200.0, 300.0, 180.0, 0.0, 180.0]):
            hardware_recursive_blockly_parser(code, ctx, obj_qs, act_qs, loc_qs)

        # 1 search per pick per iteration = 2 searches
        assert mock_search.call_count == 2
        # 1 post-pick raise + 1 place move per iteration = 4 robot_move calls
        assert ctx.client.robot_move.call_count == 4

    def test_gripper_open_on_place(self):
        code = {
            "type": "repeat_block",
            "fields": {"times": "1"},
            "inputs": {
                "DO": {"block": _pick_block(next_block=_place_block())}
            },
        }
        ctx = make_ctx()
        obj_qs = make_qs([mock_obj()])
        loc_qs = make_qs([mock_loc()])
        act_qs = make_qs([])

        with patch("backend.functions.task.search_object", return_value=(True, 0)), \
             patch("backend.functions.task.robot_getvar", return_value=[100.0, 200.0, 300.0, 180.0, 0.0, 180.0]), \
             patch("backend.functions.task.open_hand") as mock_open:
            hardware_recursive_blockly_parser(code, ctx, obj_qs, act_qs, loc_qs)

        # open_hand called once per place
        assert mock_open.call_count == 1

    def test_object_not_found_raises(self):
        code = _pick_block()
        ctx = make_ctx()
        obj_qs = make_qs([mock_obj()])
        loc_qs = make_qs([])
        act_qs = make_qs([])

        with patch("backend.functions.task.search_object", return_value=(False, 0)), \
             patch("backend.functions.task.robot_getvar", return_value=[0.0] * 6):
            with pytest.raises(RuntimeError, match="Object not found"):
                hardware_recursive_blockly_parser(code, ctx, obj_qs, act_qs, loc_qs)


class TestOpenCloseGripper:
    """open_gripper → close_gripper — gripper Execute calls."""

    def test_open_gripper_calls_open_hand(self):
        code = {"type": "open_gripper_block"}
        ctx = make_ctx()

        with patch("backend.functions.task.open_hand") as mock_open:
            hardware_recursive_blockly_parser(code, ctx, make_qs([]), make_qs([]), make_qs([]))

        assert mock_open.call_count == 1

    def test_close_gripper_calls_hand_move_h(self):
        code = {"type": "close_gripper_block"}
        ctx = make_ctx()

        with patch("backend.functions.task.switch_bcap_to_orin"), \
             patch("backend.functions.task.switch_orin_to_bcap"):
            hardware_recursive_blockly_parser(code, ctx, make_qs([]), make_qs([]), make_qs([]))

        ctx.ctrl.Execute.assert_called_once()
        call_args = ctx.ctrl.Execute.call_args[0]
        assert call_args[1] == [6, 1]

    def test_open_then_close_sequence(self, capsys):
        code = {
            "type": "open_gripper_block",
            "next": {"block": {"type": "close_gripper_block"}},
        }
        ctx = make_ctx()

        with patch("backend.functions.task.open_hand"), \
             patch("backend.functions.task.switch_bcap_to_orin"), \
             patch("backend.functions.task.switch_orin_to_bcap"):
            hardware_recursive_blockly_parser(code, ctx, make_qs([]), make_qs([]), make_qs([]))

        captured = capsys.readouterr()
        # Block execution trace via print output
        assert "[HW] Gripper: OPEN" in captured.out
        assert "[HW] Gripper: CLOSE" in captured.out


class TestProcessingBlock:
    """pick → processing → place — action point BCAP calls."""

    def test_processing_action_points_issued(self):
        code = _pick_block(
            next_block=_processing_block(
                next_block=_place_block()
            )
        )
        ctx = make_ctx()
        obj_qs = make_qs([mock_obj()])
        act_qs = make_qs([mock_action()])
        loc_qs = make_qs([mock_loc()])

        with patch("backend.functions.task.search_object", return_value=(True, 0)), \
             patch("backend.functions.task.robot_getvar", return_value=[100.0, 200.0, 300.0, 180.0, 0.0, 180.0]):
            hardware_recursive_blockly_parser(code, ctx, obj_qs, act_qs, loc_qs)

        # post-pick raise (1) + 1 action point (1) + place (1) = 3 robot_move calls
        assert ctx.client.robot_move.call_count == 3


class TestWhenCondition:
    """when(find_object, pick→place) — condition eval + branch execution."""

    def test_when_true_executes_do_branch(self):
        find_condition = {
            "type": "find_object_block",
            "inputs": {
                "OBJECT": {"block": {"data": json.dumps({"id": 1, "name": "flask"})}}
            },
        }
        code = {
            "type": "when_block",
            "inputs": {
                "WHEN": {"block": find_condition},
                "DO": {"block": _pick_block(next_block=_place_block())},
            },
        }
        ctx = make_ctx()
        obj_qs = make_qs([mock_obj()])
        loc_qs = make_qs([mock_loc()])
        act_qs = make_qs([])

        with patch("backend.functions.task.search_object", return_value=(True, 0)) as mock_search, \
             patch("backend.functions.task.robot_getvar", return_value=[100.0, 200.0, 300.0, 180.0, 0.0, 180.0]):
            hardware_recursive_blockly_parser(code, ctx, obj_qs, act_qs, loc_qs)

        # 1 for condition eval + 1 for pick DO branch = 2
        assert mock_search.call_count == 2

    def test_when_false_skips_do_branch(self):
        find_condition = {
            "type": "find_object_block",
            "inputs": {
                "OBJECT": {"block": {"data": json.dumps({"id": 1, "name": "flask"})}}
            },
        }
        code = {
            "type": "when_block",
            "inputs": {
                "WHEN": {"block": find_condition},
                "DO": {"block": _pick_block(next_block=_place_block())},
            },
        }
        ctx = make_ctx()
        obj_qs = make_qs([mock_obj()])
        loc_qs = make_qs([mock_loc()])
        act_qs = make_qs([])

        with patch("backend.functions.task.search_object", return_value=(False, 0)) as mock_search, \
             patch("backend.functions.task.robot_getvar", return_value=[0.0] * 6):
            hardware_recursive_blockly_parser(code, ctx, obj_qs, act_qs, loc_qs)

        # only 1 search for condition eval; DO branch not entered
        assert mock_search.call_count == 1
        assert ctx.client.robot_move.call_count == 0


class TestWaitBlock:
    """wait_block — time.sleep called with correct duration."""

    def test_wait_calls_sleep(self):
        code = {"type": "wait_block", "fields": {"SECONDS": "3"}}
        ctx = make_ctx()

        with patch("backend.functions.task.time") as mock_time:
            hardware_recursive_blockly_parser(code, ctx, make_qs([]), make_qs([]), make_qs([]))

        mock_time.sleep.assert_called_once_with(3)


class TestMoveToBlock:
    """move_to_block — BCAP mode matches motion_type (LINEAR=2, JOINT=1)."""

    def test_linear_uses_mode_2(self):
        code = {
            "type": "move_to_block",
            "fields": {"MOTION_TYPE": "LINEAR"},
            "inputs": {
                "LOCATION": {"block": {"data": json.dumps({"id": 10, "name": "tray"})}}
            },
        }
        ctx = make_ctx()
        loc_qs = make_qs([mock_loc()])

        hardware_recursive_blockly_parser(code, ctx, make_qs([]), make_qs([]), loc_qs)

        ctx.client.robot_move.assert_called_once()
        assert ctx.client.robot_move.call_args[0][1] == 2

    def test_joint_uses_mode_1(self):
        code = {
            "type": "move_to_block",
            "fields": {"MOTION_TYPE": "JOINT"},
            "inputs": {
                "LOCATION": {"block": {"data": json.dumps({"id": 10, "name": "tray"})}}
            },
        }
        ctx = make_ctx()
        loc_qs = make_qs([mock_loc()])

        hardware_recursive_blockly_parser(code, ctx, make_qs([]), make_qs([]), loc_qs)

        ctx.client.robot_move.assert_called_once()
        assert ctx.client.robot_move.call_args[0][1] == 1
