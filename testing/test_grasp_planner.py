#!/usr/bin/env python3
"""
Phase 2 grasp-planner unit tests — pure geometry, no Gazebo.

Passing means: RELIABLE SUPPORT FOR SIMPLE TOP-GRASPABLE SHAPES (cylinders,
boxes, well-formed proxies). It does NOT mean general custom-object support —
side grasps, concave/multi-collision shapes and richer grasp families are
Phase 3 and out of scope.

Run with:
    poetry run python -m pytest testing/test_grasp_planner.py -v
"""
import os
import sys
import math

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")
try:
    import django
    django.setup()
except Exception:
    pass

from backend.functions import simulate  # noqa: E402
from backend.functions.simulate import (  # noqa: E402
    normalize_object_for_grasp,
    plan_pick_for_object,
    GRIPPER_GRIP_CLEARANCE_MM,
    PICK_Z_REF_OFFSET,
    PICK_Z_FINE_TUNE,
)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers: write throwaway object SDFs into a fake BASE_DIR (monkeypatched)
# ─────────────────────────────────────────────────────────────────────────────

def _cyl(r, ln, pz=0.0):
    return (f'<collision name="c"><pose>0 0 {pz} 0 0 0</pose><geometry>'
            f'<cylinder><radius>{r}</radius><length>{ln}</length></cylinder>'
            f'</geometry></collision>')


def _box(sx, sy, sz, pz=0.0):
    return (f'<collision name="b"><pose>0 0 {pz} 0 0 0</pose><geometry>'
            f'<box><size>{sx} {sy} {sz}</size></box></geometry></collision>')


def _write_object(base, name, collisions_xml, meta=None):
    d = base / "ros2_ws" / "Cobotta" / "objects" / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "model.sdf").write_text(
        f'<?xml version="1.0"?><sdf version="1.5"><model name="{name}">'
        f'<link name="link">{collisions_xml}</link></model></sdf>')
    if meta is not None:
        import json
        (d / "object.meta.json").write_text(json.dumps(meta))
    return d


@pytest.fixture
def fake_objects(tmp_path, monkeypatch):
    monkeypatch.setattr(simulate, "BASE_DIR", str(tmp_path))
    return tmp_path


# ─────────────────────────────────────────────────────────────────────────────
# Classification from collision geometry
# ─────────────────────────────────────────────────────────────────────────────

def test_cylinder_top_graspable(fake_objects):
    _write_object(fake_objects, "cyl_test", _cyl(0.0075, 0.10))
    m = normalize_object_for_grasp("cyl_test")
    assert m.collision_type == "cylinder"
    assert m.feasible and m.grasp_classification == "top"
    assert m.yaw_symmetric is True and m.tool_yaw == 0.0
    assert abs(m.graspable_width - 0.015) < 1e-6
    assert abs(m.min_z - (-0.05)) < 1e-6
    assert abs(m.place_support_offset - 0.05) < 1e-6


def test_box_grasp_across_shorter_side(fake_objects):
    # 20 mm (x) × 12 mm (y) × 40 mm → fingers close across the 12 mm side
    _write_object(fake_objects, "box_test", _box(0.020, 0.012, 0.040))
    m = normalize_object_for_grasp("box_test")
    assert m.collision_type == "box"
    assert m.feasible and m.grasp_classification == "top"
    assert m.yaw_symmetric is False
    assert abs(m.graspable_width - 0.012) < 1e-6
    # y is the shorter side → convention yaw = 0 (fingers close along world-Y)
    assert m.tool_yaw == 0.0


def test_box_x_shorter_rotates_yaw(fake_objects):
    # 12 mm (x) × 20 mm (y) → x is shorter → rotate 90°
    _write_object(fake_objects, "box_rot", _box(0.012, 0.020, 0.040))
    m = normalize_object_for_grasp("box_rot")
    assert abs(m.graspable_width - 0.012) < 1e-6
    assert abs(m.tool_yaw - math.pi / 2.0) < 1e-6


def test_too_wide_is_infeasible(fake_objects):
    _write_object(fake_objects, "wide_test", _box(0.050, 0.050, 0.040))
    m = normalize_object_for_grasp("wide_test")
    assert m.grasp_classification == "needs_side"
    assert m.feasible is False
    assert "side grasp" in m.reason.lower()
    p = plan_pick_for_object(m, -0.05, -0.28)
    assert p.feasible is False and p.hand_close == 0


def test_missing_sdf_infeasible(fake_objects):
    m = normalize_object_for_grasp("does_not_exist")
    assert m.feasible is False
    assert m.grasp_classification == "unsupported"


def test_multi_cylinder_uses_body_width(fake_objects):
    # body Ø15 mm centred + wider cap Ø18 mm on top: grasp height is on the body,
    # so graspable_width must be the body (15 mm), NOT the cap — this is what
    # subsumes the old flask name special-case.
    body = _cyl(0.0075, 0.065, pz=0.0)
    cap = _cyl(0.009, 0.010, pz=0.0375)
    _write_object(fake_objects, "flaskish", body + cap)
    m = normalize_object_for_grasp("flaskish")
    assert m.collision_type == "cylinder"
    assert abs(m.graspable_width - 0.015) < 1e-6
    assert m.feasible and m.grasp_classification == "top"


# ─────────────────────────────────────────────────────────────────────────────
# Metadata sidecar (Level 2 override)
# ─────────────────────────────────────────────────────────────────────────────

def test_meta_sidecar_override(fake_objects):
    meta = {
        "grasp_modes": ["top"],
        "preferred_grasp": "top",
        "grasp_center_offset": [0.0, 0.0, 0.012],
        "max_grasp_width": 0.018,
        "place_support_offset": [0.0, 0.0, -0.032],
        "yaw_symmetry": True,
    }
    _write_object(fake_objects, "meta_obj", _box(0.025, 0.025, 0.050), meta=meta)
    m = normalize_object_for_grasp("meta_obj")
    assert m.source == "meta_override"
    assert abs(m.graspable_width - 0.018) < 1e-6        # overridden (was 25 mm → infeasible)
    assert abs(m.grasp_center_offset - 0.012) < 1e-6
    assert abs(m.place_support_offset - 0.032) < 1e-6
    assert m.yaw_symmetric is True and m.tool_yaw == 0.0
    assert m.feasible is True


# ─────────────────────────────────────────────────────────────────────────────
# plan_pick_for_object
# ─────────────────────────────────────────────────────────────────────────────

def test_plan_z_pick_and_hand_close(fake_objects):
    _write_object(fake_objects, "plan_cyl", _cyl(0.0075, 0.10))
    m = normalize_object_for_grasp("plan_cyl")
    p = plan_pick_for_object(m, -0.05, -0.28)
    assert p.feasible is True
    assert abs(p.z_pick - (PICK_Z_REF_OFFSET + m.grasp_center_offset + PICK_Z_FINE_TUNE)) < 1e-9
    expected_close = int(min(30, max(0, round(0.015 * 1000 - GRIPPER_GRIP_CLEARANCE_MM))))
    assert p.hand_close == expected_close
    assert p.spawn_pose == (-0.05, -0.28)
    assert p.planning_notes["top_grasp_only"] is True
    assert p.planning_notes["source"] == "heuristic"


# ─────────────────────────────────────────────────────────────────────────────
# Real demo objects (no monkeypatch — read the actual SDFs)
# ─────────────────────────────────────────────────────────────────────────────

def test_real_tube_top_graspable():
    m = normalize_object_for_grasp("tube")
    assert m.collision_type == "cylinder"
    assert m.feasible and m.grasp_classification == "top"
    # body grip ~15-18 mm, well under the hand max
    assert m.graspable_width <= 0.020


# ─────────────────────────────────────────────────────────────────────────────
# object.meta.json values tuned on physical hardware 2026-07-29 — pinned so a
# future accidental edit (SDF or meta) is caught immediately rather than
# silently drifting back toward the pre-tuning behaviour these fixed:
# - yellow/green tube: cap was sticking to the open gripper on release: the
#   grasp width described the CAP's diameter (~19mm), not the 15mm body, and
#   GRIPPER_GRIP_CLEARANCE_MM=4mm on a soft cap left 4mm of crush — widened by
#   1mm to reduce that crush.
# - tube: grasp height raised 2mm per user feedback after physical testing.
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("name,expected_width_mm", [("yellow_tube", 20), ("green_tube", 20)])
def test_tuned_tube_cap_grasp_width(name, expected_width_mm):
    import json
    meta_path = os.path.join(
        os.path.dirname(__file__), "..", "ros2_ws", "Cobotta", "objects", name, "object.meta.json")
    with open(meta_path) as f:
        meta = json.load(f)
    assert round(meta["max_grasp_width"] * 1000) == expected_width_mm


def test_tuned_tube_grasp_height():
    import json
    meta_path = os.path.join(
        os.path.dirname(__file__), "..", "ros2_ws", "Cobotta", "objects", "tube", "object.meta.json")
    with open(meta_path) as f:
        meta = json.load(f)
    assert abs(meta["grasp_center_offset"][2] - 0.0686) < 1e-6


# ─────────────────────────────────────────────────────────────────────────────
# SDF <-> object.meta.json coherence, every object with a meta sidecar — a
# loose sanity net (this asset family deliberately grasps near a cap/neck
# well above the collision body's own top surface, so this can't assert an
# exact geometric relationship) meant to catch the class of mistake "SDF
# changed, meta.json forgotten" (a wildly wrong value, e.g. a stray decimal
# point), not to constrain legitimate per-object calibration.
# ─────────────────────────────────────────────────────────────────────────────

def _all_meta_object_names():
    objects_dir = os.path.join(os.path.dirname(__file__), "..", "ros2_ws", "Cobotta", "objects")
    return sorted(
        name for name in os.listdir(objects_dir)
        if os.path.isfile(os.path.join(objects_dir, name, "object.meta.json"))
    )


@pytest.mark.parametrize("name", _all_meta_object_names())
def test_object_meta_sanity(name):
    import json
    meta_path = os.path.join(
        os.path.dirname(__file__), "..", "ros2_ws", "Cobotta", "objects", name, "object.meta.json")
    with open(meta_path) as f:
        meta = json.load(f)

    assert "grasp_center_offset" in meta and "max_grasp_width" in meta
    offset_z = meta["grasp_center_offset"][2]
    width_m = meta["max_grasp_width"]

    # Catches a stray decimal point / unit mixup (e.g. mm written where m is
    # expected) without constraining the neck/cap-height convention some of
    # these objects legitimately use.
    assert 0 < offset_z < 0.15, f"{name}: grasp_center_offset z={offset_z} looks implausible"
    assert 0 < width_m <= simulate.MAX_GRIP_WIDTH_MM / 1000.0, (
        f"{name}: max_grasp_width={width_m} exceeds the gripper's own MAX_GRIP_WIDTH_MM "
        "(the pick would be classified infeasible)")
