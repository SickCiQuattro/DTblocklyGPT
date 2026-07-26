"""Gesture-recognition accuracy protocol — live check, needs a webcam.

Companion to testing/test_vision_color.py's Gate V6 (same "script, not
pytest" reasoning — this needs a camera and a human performing gestures on
cue, so it can't run in CI). Feeds real frames through the exact same
GestureEngine singleton vision_live.py uses in production (via
vision_live._get_models()), so the numbers reflect the deployed thresholds
(hold_time=0.35s, min_confidence=0.6 — see backend/functions/vision_live.py
and the hand_gesture package's config.py), not a reimplementation.

For each of the 6 gestures the app exposes as a block condition
(frontend/src/constants/recognitionRegistry.ts — keep this list in sync by
hand, same caveat as vision_live._GESTURE_WORDS), it asks the operator to
hold that gesture for a few seconds, feeds every captured frame to the
recognizer, and tallies:
  - a confusion matrix: expected gesture -> observed stable label -> count
    (NONE and orphan labels THREE/PINCH/POINTING count as observations too)
  - onset latency: seconds from window start to the first stable emission
    of ANY label, and to the first one matching the expected gesture

Run:
    poetry run python testing/measure_gesture_accuracy.py           # webcam 0
    poetry run python testing/measure_gesture_accuracy.py 1 --hold 5

Results are printed and dumped to testing/out/gesture_accuracy_<ts>.json.
"""

import os
import sys
import json
import time
from collections import Counter, defaultdict

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

try:
    import django
    django.setup()
except Exception:
    pass

# Must match frontend/src/constants/recognitionRegistry.ts RECOGNIZED_GESTURES.
GESTURES = [
    ("THUMBS_UP", "Thumbs up"),
    ("THUMBS_DOWN", "Thumbs down"),
    ("OPEN_HAND", "Open hand"),
    ("FIST", "Fist"),
    ("PEACE", "Peace sign"),
    ("OK", "OK sign"),
]

DEFAULT_HOLD_S = 4.0
COUNTDOWN_S = 2.0


def main(source, hold_s=DEFAULT_HOLD_S):
    import cv2
    from backend.functions.vision_live import _get_models

    engine = _get_models()
    if not engine:
        sys.exit(
            "Gesture engine failed to load (see vision_live._ensure_gesture_model "
            "logs above) — nothing to measure."
        )

    cap = cv2.VideoCapture(int(source) if str(source).isdigit() else source)
    if not cap.isOpened():
        sys.exit(f"Camera '{source}' not open")

    confusion: dict = defaultdict(Counter)
    onset_any_s: dict = {}
    onset_correct_s: dict = {}

    for code, label in GESTURES:
        print(f"\n=== Get ready: {label} ({code}) ===")
        for remaining in range(int(COUNTDOWN_S), 0, -1):
            print(f"  starting in {remaining}...", end="\r")
            time.sleep(1.0)
        print(f"  HOLD IT NOW for {hold_s:.0f}s ...           ")

        window_start = time.monotonic()
        first_any = None
        first_correct = None
        while time.monotonic() - window_start < hold_s:
            ok, frame = cap.read()
            if not ok:
                continue
            _, stable = engine.process(frame)
            if stable:
                observed = stable.upper().replace(" ", "_")
                confusion[code][observed] += 1
                t = time.monotonic() - window_start
                if first_any is None:
                    first_any = t
                if observed == code and first_correct is None:
                    first_correct = t
                print(f"    t={t:4.1f}s observed={observed}")

        onset_any_s[code] = first_any
        onset_correct_s[code] = first_correct

    cap.release()

    print("\n=== CONFUSION MATRIX (rows=expected, cols=observed count) ===")
    observed_labels = sorted({o for row in confusion.values() for o in row})
    header = "expected".ljust(14) + "".join(o.ljust(14) for o in observed_labels)
    print(header)
    for code, _ in GESTURES:
        row = confusion.get(code, Counter())
        print(code.ljust(14) + "".join(str(row.get(o, 0)).ljust(14) for o in observed_labels))

    print("\n=== RECALL + ONSET LATENCY ===")
    results = {}
    for code, label in GESTURES:
        row = confusion.get(code, Counter())
        total = sum(row.values())
        correct = row.get(code, 0)
        recall = correct / total if total else 0.0
        print(
            f"{label:14s} recall={recall:6.1%}  "
            f"onset(any)={onset_any_s[code]!s:>6}  "
            f"onset(correct)={onset_correct_s[code]!s:>6}"
        )
        results[code] = {
            "label": label,
            "confusion": dict(row),
            "recall": recall,
            "onset_any_s": onset_any_s[code],
            "onset_correct_s": onset_correct_s[code],
        }

    out_dir = os.path.join(os.path.dirname(__file__), "out")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"gesture_accuracy_{int(time.time())}.json")
    with open(out_path, "w") as f:
        json.dump(
            {"hold_s": hold_s, "results": results},
            f,
            indent=2,
        )
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    argv = sys.argv[1:]
    hold_s = DEFAULT_HOLD_S
    if "--hold" in argv:
        i = argv.index("--hold")
        hold_s = float(argv.pop(i + 1))
        argv.pop(i)
    source = argv[0] if argv else "0"
    main(source, hold_s=hold_s)
