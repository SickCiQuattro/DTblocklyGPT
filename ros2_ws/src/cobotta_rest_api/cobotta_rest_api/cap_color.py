"""Cap colour classification on top of (or independent of) YOLO detections.

Two entry points share the same HSV colour bins:

- ``classify_hsv(roi)``   — dominant colour of a BGR crop (e.g. the top of a
  "bottle" bbox, where the test-tube cap sits).
- ``detect_cap_blobs(frame)`` — standalone detector for saturated coloured
  blobs. Used when YOLO does not see the tube (gate-V6 fallback) and in
  Gazebo, where rendered cap colours are pure.

Pure OpenCV/numpy — no ROS imports, unit-testable offline.
"""

import cv2
import numpy as np

# OpenCV hue range is 0-179; red wraps around the origin.
COLOR_BINS = {
    "red": ((0, 10), (170, 179)),
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
CAP_REGION_FRACTION = 0.3


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


def classify_hsv(bgr_roi):
    """Return the dominant colour name of a BGR crop, or None.

    Saturated pixels vote into hue bins; a histogram vote (not a median)
    handles the red wrap-around at hue 0/179.
    """
    if bgr_roi is None or bgr_roi.size == 0:
        return None
    hsv = cv2.cvtColor(bgr_roi, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    saturated = (s >= SAT_MIN) & (v >= VAL_MIN)
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
