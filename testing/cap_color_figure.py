"""Render the cap-colour pipeline stage by stage, for one of the real frames.

Run:
    poetry run python testing/cap_color_figure.py Rob_test2provette1.png

Produces, per detected cap: the raw cap ROI, the same ROI after gray-world
white balance, and the colour the classifier votes for. Written to
testing/out/vision_check/<frame>_caps.png.

Everything here calls the production functions in cap_color.py — nothing is
reimplemented, so the figure cannot drift from what the robot actually sees.
Bounding boxes come from testing/test_cap_color_real_frames.py (YOLOE's own
boxes from the runs that produced those numbers), for the same reason.

The one thing worth stating explicitly, because it is the trap this pipeline
was built around: white balance runs ONCE on the FULL frame, before any
cropping. Gray-world assumes the sample averages to neutral grey; a cap-sized
crop is dominated by the cap itself, so balancing per-crop invents a cast that
was never there and can flip the classification. The figure therefore crops
the cap out of the already-balanced frame — it does not balance the crop.
"""
import os
import sys

import cv2
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

sys.path.insert(0, os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "ros2_ws", "src", "cobotta_rest_api")))

from cobotta_rest_api.cap_color import (  # noqa: E402
    SAT_MIN,
    VAL_MIN,
    cap_region,
    classify_hsv,
    normalize_white_balance,
    sample_background_hue,
)
from test_cap_color_real_frames import CAPS, KNOWN_UNREADABLE, FRAMES  # noqa: E402

# Swatch colours for the label, so the printed name is checkable at a glance.
SWATCH = {
    "red": "#d62728", "orange": "#ff7f0e", "yellow": "#e8d21d",
    "green": "#2ca02c", "blue": "#1f77b4",
}


def _bgr_to_rgb(img):
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def _dominant_hue(roi, background_hue):
    """Mean hue of the pixels that actually vote, plus how many there are.

    Mirrors classify_hsv's own mask (saturation/value floors, background-hue
    exclusion) so the number printed is the one the vote was taken over, not a
    statistic of the whole crop.
    """
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    mask = (s >= SAT_MIN) & (v >= VAL_MIN)
    if background_hue is not None:
        from cobotta_rest_api.cap_color import (
            BACKGROUND_HUE_TOLERANCE, _hue_circular_distance,
        )
        mask &= _hue_circular_distance(h, background_hue) > BACKGROUND_HUE_TOLERANCE
    if not mask.any():
        return None, 0.0
    return float(np.mean(h[mask])), 100.0 * mask.sum() / mask.size


def build_figure(frame_name):
    path = os.path.join(FRAMES, frame_name)
    frame = cv2.imread(path)
    if frame is None:
        raise SystemExit(f"cannot read {path}")

    caps = [(b, c) for f, b, c in CAPS if f == frame_name]
    unreadable = [(b, c) for f, b, c in KNOWN_UNREADABLE if f == frame_name]
    if not caps and not unreadable:
        raise SystemExit(f"no caps listed for {frame_name} in test_cap_color_real_frames.py")

    # ONCE, on the whole frame — see module docstring.
    wb = normalize_white_balance(frame)

    rows = caps + unreadable
    fig, axes = plt.subplots(len(rows), 3, figsize=(11, 3.3 * len(rows)), squeeze=False)

    for i, (bbox, expected) in enumerate(rows):
        bg_hue = sample_background_hue(wb, bbox)
        roi_raw = cap_region(frame, bbox)
        roi_wb = cap_region(wb, bbox)
        got = classify_hsv(roi_wb, background_hue=bg_hue)
        hue, share = _dominant_hue(roi_wb, bg_hue)

        x1, y1, x2, y2 = (int(v) for v in bbox)
        ctx = frame[max(0, y1 - 40):y2, max(0, x1 - 40):x2 + 40]
        axes[i][0].imshow(_bgr_to_rgb(ctx))
        axes[i][0].set_title(f"rilevazione (atteso: {expected})", fontsize=10)

        axes[i][1].imshow(_bgr_to_rgb(roi_raw))
        axes[i][1].set_title("ROI tappo — grezza", fontsize=10)

        axes[i][2].imshow(_bgr_to_rgb(roi_wb))
        label = got if got else "non classificabile"
        hue_txt = f"hue {hue:.0f}, {share:.1f}% pixel saturi" if hue is not None else "nessun pixel saturo"
        axes[i][2].set_title(
            f"ROI dopo white balance\n{label}  ({hue_txt})",
            fontsize=10,
            color=SWATCH.get(got, "#444444"),
            fontweight="bold" if got else "normal",
        )
        # Frame the balanced ROI in the colour the classifier voted for.
        for spine in axes[i][2].spines.values():
            spine.set_edgecolor(SWATCH.get(got, "#999999"))
            spine.set_linewidth(3)

        for ax in axes[i]:
            ax.set_xticks([])
            ax.set_yticks([])
        status = "OK" if got == expected else ("atteso None" if expected and got is None and (bbox, expected) in unreadable else "MISMATCH")
        print(f"  {frame_name} {bbox} atteso={expected!s:<8} ottenuto={got!s:<8} {status}")

    fig.suptitle(
        f"{frame_name} — classificazione colore tappo\n"
        "white balance gray-world applicato una volta sul frame intero, poi ritaglio",
        fontsize=11,
    )
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    out = os.path.join(FRAMES, frame_name.replace(".png", "_caps.png"))
    fig.savefig(out, dpi=140)
    plt.close(fig)
    return out


if __name__ == "__main__":
    names = sys.argv[1:] or ["Rob_test2provette1.png"]
    for n in names:
        print(f"[{n}]")
        print("saved:", build_figure(n))
