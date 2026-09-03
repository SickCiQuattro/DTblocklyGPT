"""Guard on the pick's lift check: a weld is confirmed by watching, not by asking.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_grasp_lift_check.py -v

`attach_object_to_gripper` asks the DetachableJoint plugin whether it attached,
and its docstring already records why the publish's exit code is not enough:
gz-sim8 can silently refuse a re-attach after a same-named entity is deleted
and respawned. What that does not cover is the plugin BELIEVING it attached
while holding a stale child entity from before the respawn. The state topic
says "attached", nothing is welded, and the tube rides up on friction between
the closing fingers — then drops on the transit, or partway down the place
descent, before the gripper has opened.

Reported 2026-09-03 on the second pick of a run and never the first, which is
the shape a stale child entity predicts: the first pick is the only one whose
"object" the plugin resolved fresh.

So the pick now asks the world. The rules this pins down:

  * compare RISES, never absolute heights. The commanded lift is
    robot-relative and the model pose is world-absolute; the two frames differ
    by ROBOT_BASE_Z, a distinction this codebase has been bitten by before and
    which a comparison of deltas does not have to get right.
  * an unreadable pose is not a failure. A missed `gz model` read is a reason
    to know less, not to abort a run that may be fine.
"""
import os
import re
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

SIMULATE = os.path.join(
    os.path.dirname(__file__), "..", "backend", "functions", "simulate.py"
)


def test_a_lift_that_moved_the_object_passes():
    assert simulate._verify_sim_grasp(1.02, 1.12, 0.10) is True


def test_an_object_left_on_the_table_fails():
    """The whole point: the plugin said attached, the object did not move."""
    assert simulate._verify_sim_grasp(1.02, 1.0201, 0.10) is False


def test_a_partial_rise_still_counts():
    """Half the commanded lift is enough. The arm is mid-trajectory when this
    reads, and a threshold tight enough to catch a slow frame would abort
    perfectly good picks."""
    assert simulate._verify_sim_grasp(1.02, 1.07, 0.10) is True


@pytest.mark.parametrize("before,after", [(None, 1.12), (1.02, None), (None, None)])
def test_an_unreadable_pose_is_not_a_failure(before, after):
    assert simulate._verify_sim_grasp(before, after, 0.10) is True


def test_the_check_runs_after_the_lift_and_aborts():
    """Placed after the lift because before it there is nothing to observe, and
    wired to _abort_task because a pick that did not take must not continue
    into a transit and a descent."""
    src = open(SIMULATE, encoding="utf-8").read()
    pick = src[src.index("def simulate_ros_pick"):src.index("def simulate_ros_initial_position")]
    assert "_verify_sim_grasp(" in pick, (
        "il pick non verifica piu' che l'oggetto sia salito con il braccio: "
        "un weld finto torna a essere indistinguibile da uno riuscito."
    )
    check_at = pick.index("_verify_sim_grasp(")
    lift_at = pick.index("send_waypoints(lift_path")
    assert lift_at < check_at, (
        "la verifica precede il sollevamento: prima di sollevare non c'e' "
        "niente da osservare."
    )
    tail = pick[check_at:check_at + 700]
    assert "_abort_task(" in tail, (
        "la verifica non abortisce piu': il pick proseguirebbe fino a far "
        "cadere la provetta durante il trasferimento o la discesa."
    )


def test_the_pose_reader_takes_the_model_pose_not_a_link_pose():
    """`gz model -m` prints the model pose first and link poses after it, and
    the link poses are relative to the model — reading one of those would
    compare a height against a different origin."""
    body = re.search(
        r"def get_object_world_z\(\):.*?\n(?=\ndef )", open(SIMULATE, encoding="utf-8").read(), re.S
    )
    assert body, "get_object_world_z e' sparito"
    assert "re.search(" in body.group(0), (
        "il lettore di posa non estrae piu' la prima corrispondenza: "
        "re.search prende la posa del MODELLO, findall prenderebbe anche "
        "quelle dei link, che sono relative a essa."
    )


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
