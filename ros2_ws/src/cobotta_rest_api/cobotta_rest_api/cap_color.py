"""Cap colour classification on top of (or independent of) YOLO detections.

Two entry points share the same HSV colour bins:

- ``classify_hsv(roi)``   — dominant colour of a BGR crop (e.g. the top of a
  "bottle" bbox, where the test-tube cap sits).
- ``detect_cap_blobs(frame)`` — standalone detector for saturated coloured
  blobs. Used when YOLO does not see the tube (gate-V6 fallback) and in
  Gazebo, where rendered cap colours are pure.

A third helper, ``sample_background_hue``, feeds ``classify_hsv`` the local
background colour so it can be excluded from the vote — see its docstring
for why (real-camera false positive found 2026-07-13: a warm light cast
made a plain brown table read as "red").

A fourth, ``normalize_white_balance``, corrects a uniform colour cast (same
kind of warm-light problem, upstream of it) — callers apply it ONCE to the
whole raw frame, before any cropping, and feed the corrected frame into
``cap_region``/``sample_background_hue``/``detect_cap_blobs``. Gray-world
white balance only holds over a large, roughly-neutral sample; running it on
a small crop (a cap-sized ROI, or a background ring already isolated from
its object) can be dominated by whatever single colour is in that crop and
invent a cast that was never there — so it must run on the full frame, not
per-crop.

Pure OpenCV/numpy — no ROS imports, unit-testable offline.
"""

import cv2
import numpy as np

# OpenCV hue range is 0-179; red wraps around the origin.
COLOR_BINS = {
    "red": ((0, 10), (170, 179)),
    "orange": ((11, 19),),
    "yellow": ((20, 35),),
    "green": ((40, 85),),
    "blue": ((95, 130),),
}

SAT_MIN = 80
VAL_MIN = 60
# classify_hsv gives up if fewer than this fraction of the ROI is saturated,
# and requires the winning bin to hold at least this share of saturated pixels.
MIN_SATURATED_FRACTION = 0.05
MIN_BIN_SHARE = 0.3

# detect_cap_blobs area gates: caps are small; huge regions are backgrounds.
MIN_BLOB_AREA_PX = 100
MAX_BLOB_AREA_FRACTION = 0.05

# Fraction of a tube bbox (from the top) where the cap sits.
CAP_REGION_FRACTION = 0.35

# How far outside the bbox to sample the local background (and how thick a
# ring), and how close a cap_region hue has to be to that background hue to
# be treated as "background bleed" rather than the cap's own colour.
BACKGROUND_MARGIN_PX = 15
BACKGROUND_HUE_TOLERANCE = 12
# Need at least this many saturated background pixels to trust the sample —
# a background with almost no saturated pixels has nothing worth excluding.
MIN_BACKGROUND_SATURATED_PX = 10

# normalize_white_balance: pixels this saturated or more are excluded from
# the grey-mean estimate. NOT a low number — measured 2026-07-29 against the
# real camera: the "neutral" wall itself sits at S~80-100 under this rig's
# warm cast (median 91), while the red rack sits at S~150-220 (median 165).
# A textbook-low threshold (e.g. 60) excludes the wall too, leaves too
# little data, and silently falls back to the uncorrected whole-frame
# estimate — this value is picked to sit between the two clusters instead.
# If fewer than WB_MIN_NEUTRAL_FRACTION of the frame is left after
# excluding, fall back to the whole frame rather than estimating from too
# little data.
WB_SAT_THRESHOLD = 110
WB_MIN_NEUTRAL_FRACTION = 0.05


def normalize_white_balance(bgr_frame):
    """Gray-world white balance: scale each channel so its mean matches the
    frame's overall grey mean, cancelling a uniform colour cast (e.g. warm
    tungsten light) before HSV classification sees it. Neutral on already-
    balanced input (Gazebo renders), which is why it's safe to always apply.

    The grey-mean estimate is taken only from low-saturation pixels
    (background/wall), excluding anything as saturated as WB_SAT_THRESHOLD
    or more. Gray-world assumes the frame averages to neutral grey — a
    large genuinely-coloured object (e.g. the red tube rack filling much of
    the frame) breaks that assumption and gets read as a "cast" needing
    correction, over-suppressing its channel and flipping real red objects
    toward cyan/blue (found testing against the real camera, 2026-07-29).
    Excluding saturated pixels from the estimate keeps the correction based
    on what's actually neutral, not on a big saturated foreground object.
    Falls back to the whole frame if too little low-saturation area exists
    to estimate from (e.g. a fully saturated synthetic scene).

    Assumes a non-empty frame — callers already guard None/empty before
    reaching this point (see classify_hsv, detect_cap_blobs).
    """
    pixels = bgr_frame.reshape(-1, 3)
    sat = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2HSV)[:, :, 1].reshape(-1)
    neutral = pixels[sat < WB_SAT_THRESHOLD]
    if neutral.shape[0] < WB_MIN_NEUTRAL_FRACTION * pixels.shape[0]:
        neutral = pixels
    means = neutral.mean(axis=0)
    if (means <= 1e-6).any():
        return bgr_frame
    gain = means.mean() / means
    return np.clip(bgr_frame.astype(np.float32) * gain, 0, 255).astype(np.uint8)


def cap_region(bgr_frame, xyxy):
    """Return the top CAP_REGION_FRACTION slice of a bbox crop (cap zone)."""
    h_img, w_img = bgr_frame.shape[:2]
    x1, y1, x2, y2 = (int(v) for v in xyxy)
    x1, x2 = max(0, x1), min(w_img, x2)
    y1, y2 = max(0, y1), min(h_img, y2)
    if x2 <= x1 or y2 <= y1:
        return None
    cap_h = max(1, int((y2 - y1) * CAP_REGION_FRACTION))
    return bgr_frame[y1:y1 + cap_h, x1:x2]


def sample_background_hue(bgr_frame, xyxy, margin_px=BACKGROUND_MARGIN_PX):
    """Dominant hue of a thin ring just outside a detection's bbox, or None.

    ``cap_region`` crops a RECTANGLE from the top of a bbox, but a cap's own
    footprint in that rectangle is round — so the crop's corners are always
    background, whatever the cap-to-body width ratio (this holds regardless
    of object shape, unlike a fixed circular mask sized for one shape). That
    background is normally too dull to matter, but under a coloured light
    cast (e.g. warm tungsten light shifting a neutral table toward orange/
    red) it can itself look saturated enough to win classify_hsv's vote —
    reading a plain grey cap as "red" (found testing against the real
    camera, 2026-07-13). This samples what "background" actually looks like
    right now, in this frame, so classify_hsv can tell it apart from the
    cap's own colour.

    Returns None (nothing to exclude) if the background sample doesn't
    exist (bbox fills the frame) or isn't saturated enough to matter.
    """
    if bgr_frame is None or bgr_frame.size == 0:
        return None
    h_img, w_img = bgr_frame.shape[:2]
    x1, y1, x2, y2 = (int(v) for v in xyxy)
    ox1, oy1 = max(0, x1 - margin_px), max(0, y1 - margin_px)
    ox2, oy2 = min(w_img, x2 + margin_px), min(h_img, y2 + margin_px)
    outer = bgr_frame[oy1:oy2, ox1:ox2]
    if outer.size == 0:
        return None

    # Mask out the bbox itself (in the outer crop's local coordinates) so
    # only the surrounding ring is sampled, not the object itself.
    mask = np.ones(outer.shape[:2], dtype=bool)
    ry1, ry2 = max(0, y1 - oy1), max(0, y2 - oy1)
    rx1, rx2 = max(0, x1 - ox1), max(0, x2 - ox1)
    mask[ry1:ry2, rx1:rx2] = False
    if not mask.any():
        return None

    hsv = cv2.cvtColor(outer, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    saturated = mask & (s >= SAT_MIN) & (v >= VAL_MIN)
    if int(saturated.sum()) < MIN_BACKGROUND_SATURATED_PX:
        return None
    return int(np.median(h[saturated]))


def _hue_circular_distance(hues, reference_hue):
    """Shortest distance from each hue to reference_hue on the 0-179 wheel."""
    diff = np.abs(hues.astype(np.int16) - int(reference_hue))
    return np.minimum(diff, 180 - diff)


def classify_hsv(bgr_roi, background_hue=None):
    """Return the dominant colour name of a BGR crop, or None.

    Saturated pixels vote into hue bins; a histogram vote (not a median)
    handles the red wrap-around at hue 0/179. If ``background_hue`` is given
    (see ``sample_background_hue``), pixels within BACKGROUND_HUE_TOLERANCE
    of it are excluded from the vote first — see that function's docstring
    for why a rectangular crop needs this regardless of cap shape.
    """
    if bgr_roi is None or bgr_roi.size == 0:
        return None
    hsv = cv2.cvtColor(bgr_roi, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    saturated = (s >= SAT_MIN) & (v >= VAL_MIN)
    if background_hue is not None:
        saturated &= _hue_circular_distance(h, background_hue) > BACKGROUND_HUE_TOLERANCE
    total = int(saturated.sum())
    if total < MIN_SATURATED_FRACTION * bgr_roi.shape[0] * bgr_roi.shape[1]:
        return None
    hues = h[saturated]
    best, best_count = None, 0
    for name, ranges in COLOR_BINS.items():
        count = sum(int(((hues >= lo) & (hues <= hi)).sum()) for lo, hi in ranges)
        if count > best_count:
            best, best_count = name, count
    if best_count < MIN_BIN_SHARE * total:
        return None
    return best


def detect_cap_blobs(bgr_frame):
    """Detect saturated coloured blobs (caps) in a full BGR frame.

    Returns [{"color", "bbox": [x1,y1,x2,y2] px, "center": [cx,cy] 0-1}].
    """
    if bgr_frame is None or bgr_frame.size == 0:
        return []
    h_img, w_img = bgr_frame.shape[:2]
    max_area = MAX_BLOB_AREA_FRACTION * h_img * w_img
    hsv = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2HSV)
    kernel = np.ones((3, 3), np.uint8)
    blobs = []
    for name, ranges in COLOR_BINS.items():
        mask = np.zeros((h_img, w_img), np.uint8)
        for lo, hi in ranges:
            mask |= cv2.inRange(hsv, (lo, SAT_MIN, VAL_MIN), (hi, 255, 255))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < MIN_BLOB_AREA_PX or area > max_area:
                continue
            x, y, w, h = cv2.boundingRect(contour)
            blobs.append({
                "color": name,
                "bbox": [x, y, x + w, y + h],
                "center": [round((x + w / 2) / w_img, 4), round((y + h / 2) / h_img, 4)],
            })
    return blobs


def point_in_bbox(center_norm, xyxy, frame_shape):
    """True if a normalized [cx, cy] point falls inside a pixel bbox."""
    h_img, w_img = frame_shape[:2]
    cx, cy = center_norm[0] * w_img, center_norm[1] * h_img
    x1, y1, x2, y2 = xyxy
    return x1 <= cx <= x2 and y1 <= cy <= y2
