"""Offline unit tests for cap_color (HSV classification + blob detection).

No ROS, no Django models — synthetic BGR patches only.
Run: poetry run python -m pytest testing/test_cap_color.py -v
"""

import os
import sys

import cv2
import numpy as np
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "ros2_ws", "src", "cobotta_rest_api")))

from cobotta_rest_api.cap_color import (  # noqa: E402
    cap_region,
    classify_hsv,
    detect_cap_blobs,
    normalize_white_balance,
    point_in_bbox,
    sample_background_hue,
)

# Saturated BGR colours whose OpenCV hue falls squarely in each bin.
BGR = {
    "red": (0, 0, 255),
    "yellow": (0, 255, 255),
    "green": (0, 255, 0),
    "blue": (255, 0, 0),
}


def patch(bgr, h=40, w=40):
    return np.full((h, w, 3), bgr, dtype=np.uint8)


class TestClassifyHsv:
    @pytest.mark.parametrize("color", list(BGR))
    def test_solid_patch(self, color):
        assert classify_hsv(patch(BGR[color])) == color

    def test_gray_returns_none(self):
        assert classify_hsv(patch((128, 128, 128))) is None

    def test_black_returns_none(self):
        assert classify_hsv(patch((0, 0, 0))) is None

    def test_empty_and_none(self):
        assert classify_hsv(None) is None
        assert classify_hsv(np.zeros((0, 0, 3), dtype=np.uint8)) is None

    def test_mostly_gray_with_small_blue_spot(self):
        """A small saturated spot on a dull background still wins the vote."""
        roi = patch((128, 128, 128), h=40, w=40)
        roi[0:10, 0:10] = BGR["blue"]  # 6.25% of pixels, above 5% threshold
        assert classify_hsv(roi) == "blue"

    def test_background_hue_excludes_matching_pixels(self):
        """A background_hue matching the ROI's only saturated colour must
        drop it below the saturated-fraction floor — this is the exact shape
        of the real false positive (corner background bleed reading as a
        cap colour): a uniformly red ROI with background_hue=red-ish must
        return None instead of "red"."""
        roi = patch(BGR["red"])
        assert classify_hsv(roi, background_hue=0) is None

    def test_background_hue_leaves_different_colour_untouched(self):
        """Excluding the background hue must not suppress a genuinely
        different cap colour — background=red (hue 0) must not touch blue."""
        roi = patch(BGR["blue"])
        assert classify_hsv(roi, background_hue=0) == "blue"


class TestDetectCapBlobs:
    def test_two_caps_found_with_positions(self):
        frame = np.full((200, 400, 3), (200, 200, 200), dtype=np.uint8)
        frame[20:50, 30:60] = BGR["blue"]     # left blob
        frame[100:130, 300:330] = BGR["red"]  # right blob
        blobs = detect_cap_blobs(frame)
        colors = sorted(b["color"] for b in blobs)
        assert colors == ["blue", "red"]
        blue = next(b for b in blobs if b["color"] == "blue")
        assert blue["center"][0] < 0.5  # left half
        red = next(b for b in blobs if b["color"] == "red")
        assert red["center"][0] > 0.5  # right half

    def test_tiny_speck_ignored(self):
        frame = np.full((200, 400, 3), (200, 200, 200), dtype=np.uint8)
        frame[10:13, 10:13] = BGR["green"]  # 9 px < MIN_BLOB_AREA_PX
        assert detect_cap_blobs(frame) == []

    def test_huge_region_ignored(self):
        frame = np.full((200, 400, 3), BGR["yellow"], dtype=np.uint8)  # all yellow
        assert detect_cap_blobs(frame) == []

    def test_empty_frame(self):
        assert detect_cap_blobs(None) == []


class TestCapRegion:
    def test_takes_top_slice(self):
        frame = np.zeros((100, 100, 3), dtype=np.uint8)
        frame[0:30, :] = BGR["blue"]  # cap zone painted blue
        roi = cap_region(frame, [10, 0, 90, 100])
        assert roi is not None
        assert roi.shape[0] == 35  # top 35% of a 100px-tall bbox
        assert classify_hsv(roi) == "blue"

    def test_degenerate_bbox_returns_none(self):
        frame = np.zeros((100, 100, 3), dtype=np.uint8)
        assert cap_region(frame, [50, 50, 50, 50]) is None


class TestSampleBackgroundHue:
    def test_reads_hue_of_ring_around_bbox(self):
        # Whole frame is a saturated red "background"; a neutral grey
        # object sits in the middle bbox — the ring outside it is still red.
        frame = patch(BGR["red"], h=100, w=100)
        frame[30:70, 30:70] = (128, 128, 128)
        hue = sample_background_hue(frame, [30, 30, 70, 70])
        assert hue is not None
        assert hue < 5 or hue > 175  # red wraps at the hue-wheel origin

    def test_none_when_bbox_fills_frame(self):
        frame = patch(BGR["red"], h=50, w=50)
        assert sample_background_hue(frame, [0, 0, 50, 50]) is None

    def test_none_when_background_not_saturated(self):
        frame = patch((128, 128, 128), h=100, w=100)  # uniform grey, nothing to sample
        frame[30:70, 30:70] = BGR["blue"]  # the "object" itself is saturated, ring isn't
        assert sample_background_hue(frame, [30, 30, 70, 70]) is None

    def test_reproduces_real_false_positive_end_to_end(self):
        """The exact failure mode found against the real camera: a warm
        (red-ish) background bleeding into cap_region's rectangular corners
        around a neutral (non-red) cap must no longer read as "red" once
        background_hue is threaded through — this pins the fix, not just
        its two pieces in isolation."""
        frame = patch(BGR["red"], h=120, w=120)  # warm background everywhere
        # A neutral grey circular-ish cap area in the middle of the bbox —
        # cap_region's rectangular top-slice still grabs red corners around it.
        cv2.circle(frame, (60, 30), 25, (128, 128, 128), -1)
        xyxy = [10, 10, 110, 110]
        bg_hue = sample_background_hue(frame, xyxy)
        roi = cap_region(frame, xyxy)
        assert classify_hsv(roi, background_hue=bg_hue) is None  # not "red"


def warm_cast(bgr, gains=(0.7, 1.0, 1.4), h=40, w=40):
    """A solid patch as a real camera would render it under warm light —
    less blue, more red — same shape the 2026-07-13 false positive had."""
    scaled = np.clip(np.array(bgr, dtype=np.float32) * np.array(gains), 0, 255)
    return np.full((h, w, 3), scaled, dtype=np.uint8)


class TestNormalizeWhiteBalance:
    """normalize_white_balance is applied ONCE to a whole raw frame by the
    caller (vision_node._run_yolo), before cap_region/sample_background_hue/
    detect_cap_blobs crop it — gray-world needs a large, roughly-neutral
    sample, which a small crop doesn't reliably provide. These tests apply
    it the same way: whole-frame first, then classify the crop."""

    def test_corrects_a_uniform_colour_cast(self):
        cast = warm_cast((128, 128, 128), h=200, w=200)
        corrected = normalize_white_balance(cast)
        means = corrected.reshape(-1, 3).mean(axis=0)
        assert means.max() - means.min() < 2  # channels equalized back out

    def test_neutral_scene_near_identity(self):
        """Gray-world on an already-balanced multi-colour scene (Gazebo-like
        render: neutral background dominates, small saturated regions) barely
        moves pixel values — no regression on scenes that don't need
        correcting."""
        frame = np.full((200, 400, 3), (200, 200, 200), dtype=np.uint8)
        frame[20:50, 30:60] = BGR["blue"]
        frame[100:130, 300:330] = BGR["red"]
        corrected = normalize_white_balance(frame)
        assert np.abs(corrected.astype(int) - frame.astype(int)).max() < 5

    def test_warm_cast_no_longer_misread_as_red(self):
        """The exact regression this exists to fix: a neutral cap under warm
        light, on an otherwise-neutral frame, must classify as unknown
        (None), not "red", once the frame is white-balanced upstream."""
        frame = warm_cast((128, 128, 128), h=200, w=200)
        assert classify_hsv(normalize_white_balance(frame)) is None

    @pytest.mark.parametrize("color", list(BGR))
    def test_pure_colours_on_neutral_frame_unaffected(self, color):
        """Non-regression: a saturated cap on an otherwise-neutral frame
        (small saturated region, large neutral background — same shape as a
        real or Gazebo scene) still classifies correctly post white-balance."""
        frame = np.full((200, 200, 3), (128, 128, 128), dtype=np.uint8)
        frame[80:120, 80:120] = BGR[color]
        corrected = normalize_white_balance(frame)
        assert classify_hsv(corrected[80:120, 80:120]) == color

    def test_dominant_saturated_background_does_not_invert_matching_foreground(self):
        """The exact regression found 2026-07-29 against the real camera: a
        large, genuinely-red rack filling most of the frame (not a lighting
        cast) biased the old whole-frame grey-world estimate hard enough to
        flip a real red cap's hue toward cyan/blue (verified below: the OLD
        formula gives hue=90 on this exact synthetic frame). The rack's own
        saturated pixels must not count toward "what should be neutral" — a
        red cap on a red-dominated frame must still read red after
        correction."""
        frame = np.full((200, 200, 3), (150, 150, 150), dtype=np.uint8)  # neutral strip
        frame[40:200, :] = BGR["red"]  # dominant "rack" — 80% of the frame
        frame[5:35, 5:35] = np.array((60, 60, 200), dtype=np.uint8)  # red "cap" in the neutral strip
        corrected = normalize_white_balance(frame)
        assert classify_hsv(corrected[5:35, 5:35]) == "red"


class TestPointInBbox:
    def test_inside_and_outside(self):
        shape = (100, 200, 3)  # h=100, w=200
        assert point_in_bbox([0.25, 0.5], [40, 40, 60, 60], shape)   # (50, 50)
        assert not point_in_bbox([0.9, 0.9], [40, 40, 60, 60], shape)
