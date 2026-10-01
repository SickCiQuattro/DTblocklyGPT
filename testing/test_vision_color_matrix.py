"""The colour-check script's pure parts (offline, no camera, no model).

test_vision_color.py anchors each detection to a bench position and builds a
confusion matrix. If a tube goes missing from a frame, "the second detection"
is the wrong tube — that is the case worth pinning.
"""
import importlib.util
import os

_spec = importlib.util.spec_from_file_location(
    "test_vision_color_script", os.path.join(os.path.dirname(__file__), "test_vision_color.py"))
tvc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tvc)


def _d(xc, conf=0.3, color="blue"):
    return {"xc": xc, "conf": conf, "color": color, "name": "test tube"}


def test_references_come_from_the_first_complete_frame():
    frames = [[_d(500)], [_d(680), _d(870), _d(470)], [_d(468), _d(654), _d(865)]]
    assert tvc.riferimenti(frames, 3) == [470, 680, 870]
    assert tvc.riferimenti([[_d(1)], [_d(2)]], 3) is None


def test_a_missing_middle_tube_does_not_shift_the_others():
    refs = [468, 654, 865]
    slots, extras = tvc.assegna([_d(470, color="yellow"), _d(868, color="blue")], refs)
    assert set(slots) == {0, 2} and slots[2]["color"] == "blue" and not extras


def test_two_boxes_on_one_tube_keep_the_more_confident_and_count_the_other():
    slots, extras = tvc.assegna([_d(466, 0.25), _d(470, 0.40)], [468, 654, 865])
    assert slots[0]["conf"] == 0.40 and len(extras) == 1


def test_a_detection_far_from_every_tube_is_an_extra():
    slots, extras = tvc.assegna([_d(1400)], [468, 654, 865])
    assert not slots and len(extras) == 1


def test_confusion_matrix_counts_wrong_and_missing():
    atteso = ["yellow", "green", "blue"]
    esiti = [(0, "yellow"), (1, "blue"), (2, tvc.NON_TROVATA), (0, "yellow"), (1, "green")]
    m = tvc.matrice(esiti, atteso)
    assert m["yellow"] == {"yellow": 2}
    assert m["green"] == {"blue": 1, "green": 1}
    assert m["blue"] == {tvc.NON_TROVATA: 1}
