"""Gesture-recognition accuracy protocol — controlled bench, needs a webcam.

Companion to the voice bench at /measure/voice in the app: same protocol, same
result schema, so testing/recognition_report.py can put both channels in one
table. Voice has to live in the browser because that is where its recognizer
runs; gesture lives here because that is where ITS recognizer runs — the
browser only captures frames and POSTs them (frontend/src/hooks/
useWebcamVision.ts), and Django calls the GestureEngine singleton this script
drives via vision_live._get_models(). So this measures the deployed engine and
the deployed thresholds (hold_time=0.35s, min_confidence=0.6), not a
reimplementation.

Needs a machine with a webcam: the project's dev VM is headless QEMU with no
video device at all, so this has to run on a laptop, in the Poetry environment
(mediapipe lives there, not in ros2_ws/.venv).

What the protocol measures, and why each part is there:

  * per-class accuracy over repeated trials, not one trial per gesture. With
    zero errors in n trials the 95% upper bound on the error rate is about 3/n,
    so ten clean trials only support "under 30%". Thirty support "under 10%".
  * a REST class: windows where the operator holds still and any stable
    emission is a FALSE POSITIVE. This is the error that actually breaks a
    task — a spurious THUMBS_UP resolves a waiting step before the operator has
    done anything, and the robot moves on by itself. A per-gesture accuracy
    figure cannot see it.
  * randomised window order, so the operator cannot settle into a rhythm and
    order effects do not ride along with the class.
  * onset latency, from window start to the first stable emission.

Run:
    poetry run python testing/measure_gesture_accuracy.py --operator op1
    poetry run python testing/measure_gesture_accuracy.py --trials 30 --hold 4
    poetry run python testing/measure_gesture_accuracy.py 1 --operator op2

Then:
    poetry run python testing/recognition_report.py testing/out/recognition_*.json

Results go to testing/out/recognition_gesture_<operator>_<ts>.json.
"""

import os
import sys
import json
import time
import random
import argparse
import platform
import subprocess
from collections import Counter

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

# The no-gesture class. Its windows ask for stillness; anything observed in one
# is a false positive. Same role SILENCE plays in the voice bench — the names
# differ because the instruction to the operator differs.
REST = "REST"
REST_LABEL = "Hands still and relaxed"

DEFAULT_HOLD_S = 4.0
COUNTDOWN_S = 2.0

# What the browser does to a frame before the engine ever sees it
# (frontend/src/hooks/useWebcamVision.ts): mirror horizontally, then encode
# JPEG at quality 0.7 for the POST, which Django cv2.imdecode's back.
JPEG_QUALITY = 70


def _as_production_frame(frame):
    """Put a camera frame through the same handling a live run gives it.

    Feeding cap.read() straight to the engine measures the right engine on the
    wrong input: production mirrors the frame and round-trips it through JPEG
    at quality 0.7, and both change what the recognizer sees. Without this the
    numbers describe a pipeline no operator ever exercises, which defeats the
    point of measuring the deployed configuration.

    Not reproduced, and not reproducible offline: the network round-trip and
    the browser's own capture cadence. Onset latency measured here is therefore
    a lower bound on what an operator experiences.
    """
    import cv2

    mirrored = cv2.flip(frame, 1)
    ok, buf = cv2.imencode(
        ".jpg", mirrored, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]
    )
    if not ok:
        return mirrored
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def _git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=os.path.dirname(os.path.abspath(__file__)),
            stderr=subprocess.DEVNULL,
        ).decode().strip()
    except Exception:
        return "unknown"


def build_plan(trials: int, seed: int) -> list:
    """One window per trial per class, shuffled. Seeded so a session repeats."""
    plan = [code for code, _ in GESTURES for _ in range(trials)]
    plan += [REST] * trials
    random.Random(seed).shuffle(plan)
    return plan


def run_window(cap, engine, expected: str, hold_s: float) -> dict:
    """Feed frames for hold_s and record every stable emission."""
    window_start = time.monotonic()
    observations = []
    onset_any = None
    onset_correct = None

    while time.monotonic() - window_start < hold_s:
        ok, frame = cap.read()
        if not ok:
            continue
        _, stable = engine.process(_as_production_frame(frame))
        if not stable:
            continue
        observed = stable.upper().replace(" ", "_")
        t = time.monotonic() - window_start
        observations.append(observed)
        if onset_any is None:
            onset_any = t
        if observed == expected and onset_correct is None:
            onset_correct = t

    return {
        "expected": expected,
        "observations": observations,
        "onset_any_s": onset_any,
        "onset_correct_s": onset_correct,
    }


def main(source, operator: str, trials: int, hold_s: float, seed: int):
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
        sys.exit(
            f"Camera '{source}' not open.\n"
            "This protocol needs a real camera and a human hand, so it cannot run\n"
            "on the headless dev VM — that machine has no /dev/video* at all. Run it\n"
            "on a laptop with a webcam, in the Poetry environment (mediapipe lives\n"
            "there, not in ros2_ws/.venv). A non-numeric argument is passed to\n"
            "OpenCV verbatim, so a file path or an MJPEG URL also works — but both\n"
            "make the onset-latency figures meaningless, since neither is paced\n"
            "like a live camera."
        )

    labels = dict(GESTURES)
    labels[REST] = REST_LABEL
    plan = build_plan(trials, seed)
    print(
        f"\n{len(plan)} windows ({trials} per class x {len(GESTURES) + 1} classes), "
        f"{hold_s:.0f}s each, seed {seed}.\n"
        f"Roughly {len(plan) * (hold_s + COUNTDOWN_S) / 60:.0f} minutes. "
        "Ctrl-C aborts; partial results are still written.\n"
    )

    windows = []
    try:
        for i, expected in enumerate(plan, 1):
            print(f"\n=== [{i}/{len(plan)}] Get ready: {labels[expected]} ===")
            for remaining in range(int(COUNTDOWN_S), 0, -1):
                print(f"  starting in {remaining}...", end="\r")
                time.sleep(1.0)
            print(f"  HOLD IT NOW for {hold_s:.0f}s ...           ")
            result = run_window(cap, engine, expected, hold_s)
            windows.append(result)
            seen = Counter(result["observations"])
            print(f"    observed: {dict(seen) or 'nothing'}")
    except KeyboardInterrupt:
        print("\nAborted — writing what was collected so far.")
    finally:
        cap.release()

    payload = {
        "schema": "recognition-bench/1",
        "channel": "gesture",
        "operator": operator,
        "trials_per_class": trials,
        "hold_s": hold_s,
        "seed": seed,
        "classes": [code for code, _ in GESTURES] + [REST],
        "silence_class": REST,
        "meta": {
            "git_sha": _git_sha(),
            "host": platform.node(),
            "arch": platform.machine(),
            "source": str(source),
            "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            # Stated because it cannot be measured from here and it moves the
            # numbers more than anything in this file: lighting, distance to
            # the camera, and the camera itself. Record them in your notes.
            "note": "Lighting/distance/camera not captured — record them alongside this file.",
        },
        "windows": windows,
    }

    out_dir = os.path.join(os.path.dirname(__file__), "out")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(
        out_dir, f"recognition_gesture_{operator or 'anon'}_{int(time.time())}.json"
    )
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"\nWrote {out_path}")
    print("Report:  poetry run python testing/recognition_report.py " + out_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("source", nargs="?", default="0",
                        help="Camera index, or a path/URL passed to OpenCV verbatim")
    parser.add_argument("--operator", default="",
                        help="Who is performing the gestures — goes in the result file")
    parser.add_argument("--trials", type=int, default=10,
                        help="Windows per class (30 supports 'error below 10%%'; default 10)")
    parser.add_argument("--hold", type=float, default=DEFAULT_HOLD_S,
                        help="Seconds per window")
    parser.add_argument("--seed", type=int, default=None,
                        help="Window-order seed; omit for a random one (it is recorded)")
    args = parser.parse_args()
    main(
        args.source,
        operator=args.operator,
        trials=args.trials,
        hold_s=args.hold,
        seed=args.seed if args.seed is not None else random.randrange(1_000_000_000),
    )
