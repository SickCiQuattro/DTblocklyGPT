"""Cap-colour regression against the real camera frames, not synthetic patches.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_cap_color_real_frames.py -v

testing/test_cap_color.py covers the classifier with synthetic BGR patches whose
hue sits squarely in each bin. Those pass whatever the bin boundaries are, which
is exactly why they never caught this: the boundaries themselves were wrong for
this cell. Measured on the frames below, post-white-balance, the caps sit at

    orange   6- 15      yellow  24- 51
    green   68- 96      blue   108-116

so the textbook 35/40 yellow/green split cut the yellow class in half — this
cell's yellow cap is a fluorescent yellow-green — and the red band (0-10)
swallowed the orange caps. Eight of twenty caps were wrong.

The other half of the failure was the background-hue exclusion. The tubes stand
IN the red rack, so the background ring samples the rack (hue 1-3), and orange
at 6-15 falls inside the tolerance window: the exclusion deleted the cap.

These frames are the corpus those two fixes were measured on. They are
committed under testing/out/vision_check/, so this is a real regression gate
rather than a restatement of the constants.

Skipped, not failed, when the frames are absent: they are large PNGs and a
checkout without them should not report a red suite.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "ros2_ws", "src", "cobotta_rest_api")))

cv2 = pytest.importorskip("cv2")

from cobotta_rest_api.cap_color import (  # noqa: E402
    cap_region,
    classify_hsv,
    normalize_white_balance,
    sample_background_hue,
)

FRAMES = os.path.join(os.path.dirname(__file__), "out", "vision_check")

# (frame, bbox, expected colour). Boxes are YOLOE's own, from the runs that
# produced these numbers; the colours are what the caps physically are.
CAPS = [
    ("Rob_test4provette.png", [156, 566, 453, 1074], "orange"),
    ("Rob_test4provette.png", [606, 573, 779, 1073], "yellow"),
    ("Rob_test4provette.png", [808, 573, 959, 1066], "blue"),
    ("Rob_test4provette1.png", [160, 578, 451, 1075], "orange"),
    ("Rob_test4provette1.png", [400, 584, 617, 1069], "green"),
    ("Rob_test4provette1.png", [603, 573, 780, 1063], "yellow"),
    ("Rob_test4provette1.png", [811, 575, 946, 1051], "blue"),
    ("Rob_test4provette2.png", [160, 581, 451, 1076], "orange"),
    ("Rob_test4provette2.png", [400, 583, 611, 1070], "green"),
    ("Rob_test4provette2.png", [605, 574, 775, 1063], "yellow"),
    ("Rob_test4provette2.png", [812, 575, 950, 1051], "blue"),
    ("Rob_test2provette.png", [456, 582, 621, 1073], "green"),
    ("Rob_test2provette.png", [817, 570, 962, 1056], "blue"),
    ("Rob_test2provette1.png", [403, 602, 605, 1071], "blue"),
    ("Rob_test2provette1.png", [752, 592, 928, 1053], "green"),
    ("Rob_test2provette2.png", [240, 603, 451, 1078], "yellow"),
    ("Rob_test2provette2.png", [798, 513, 994, 1052], "orange"),
    ("Rob_test2provette5.png", [218, 610, 471, 1066], "yellow"),
    ("Rob_test2provette5.png", [849, 581, 1038, 1048], "blue"),
]

# The one cap this configuration still cannot read: a dark green cap in shadow,
# whose crop is 4.0% saturated against a 5% floor. That is pixels and light, not
# thresholds — listed rather than silently excluded so it stays visible, and so
# a future lighting change can promote it into CAPS.
KNOWN_UNREADABLE = [
    ("Rob_test4provette.png", [408, 566, 617, 1076], "green"),
]


def _classify(frame_name, bbox):
    path = os.path.join(FRAMES, frame_name)
    if not os.path.exists(path):
        pytest.skip(f"{frame_name} not in the checkout")
    frame = cv2.imread(path)
    if frame is None:
        pytest.skip(f"{frame_name} did not decode")
    wb = normalize_white_balance(frame)
    return classify_hsv(cap_region(wb, bbox), background_hue=sample_background_hue(wb, bbox))


@pytest.mark.parametrize("frame,bbox,expected", CAPS,
                         ids=[f"{f[9:-4]}-{c}" for f, _, c in CAPS])
def test_cap_colour_on_real_frames(frame, bbox, expected):
    assert _classify(frame, bbox) == expected


@pytest.mark.parametrize("frame,bbox,expected", KNOWN_UNREADABLE,
                         ids=[f"{f[9:-4]}-{c}" for f, _, c in KNOWN_UNREADABLE])
def test_the_known_unreadable_cap_is_still_unreadable(frame, bbox, expected):
    """Not a wish, a record: this one returns None, and None is the honest
    answer for a crop with too few saturated pixels. If it starts returning a
    colour, something got more permissive — check what, then move it to CAPS."""
    assert _classify(frame, bbox) is None
