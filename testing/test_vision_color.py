"""Gate V6 — live check: does stock YOLOv8n see real test tubes as "bottle"?

Decides the PRIMARY colour path for the pharma scenario:
  tube detection rate >= 70%  → crop-bbox over YOLO stays primary
  below                       → direct HSV blob path becomes primary
(Both paths are implemented in vision_node; this only picks the headline.)

Run at the lab with tubes in front of the camera:

    poetry run python testing/test_vision_color.py http://CAM/.../image.cgi [user] [pass]
    poetry run python testing/test_vision_color.py 0        # USB webcam index

Same gate, against an open-vocabulary model instead of stock YOLOv8n (see
docs/vision-object-catalog.md §7 for the adoption threshold this feeds):

    poetry run python testing/test_vision_color.py http://CAM/.../image.cgi "" "" \\
        --model yoloe-11s-seg.pt --classes "test tube,vial,medicine bottle,beaker,bowl"

Takes N snapshots ~0.5s apart and reports, per frame, YOLO tube detections
(with cap colour from the bbox crop) and standalone HSV blob detections.

This file is intentionally free of pytest test functions: the gate needs a
live camera, so it runs as a script, not in CI.
"""

import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "ros2_ws", "src", "cobotta_rest_api")))

N_FRAMES = 20
FRAME_DELAY_S = 0.5
TUBE_CLASSES = ("bottle", "cup")
GATE_THRESHOLD = 0.70


def _grabber(source, user, password):
    import cv2
    import numpy as np

    if source.startswith("http://") or source.startswith("https://"):
        import requests
        from requests.auth import HTTPDigestAuth

        auth = HTTPDigestAuth(user, password) if user else None

        def grab():
            resp = requests.get(source, auth=auth, timeout=3.0)
            resp.raise_for_status()
            return cv2.imdecode(np.frombuffer(resp.content, np.uint8), cv2.IMREAD_COLOR)

        return grab

    cap = cv2.VideoCapture(int(source) if source.isdigit() else source)
    if not cap.isOpened():
        sys.exit(f"Camera '{source}' not open")

    def grab():
        ok, frame = cap.read()
        return frame if ok else None

    return grab


def main(source, user="", password="", model="yolov8n.pt", classes=None, conf=0.5):
    from ultralytics import YOLO

    from cobotta_rest_api.cap_color import cap_region, classify_hsv, detect_cap_blobs

    yolo = YOLO(model)
    if classes:
        try:
            yolo.set_classes(classes)
        except AttributeError:
            print(f"{model} has no set_classes (not an open-vocabulary model) — ignoring --classes")
            classes = None
    tube_classes = set(classes) if classes else set(TUBE_CLASSES)
    grab = _grabber(source, user, password)

    frames_ok = 0
    frames_with_tube = 0
    frames_with_blob = 0
    tube_colors, blob_colors = {}, {}

    for i in range(N_FRAMES):
        frame = grab()
        if frame is None:
            print(f"frame {i + 1:>2}: GRAB FAILED")
            time.sleep(FRAME_DELAY_S)
            continue
        frames_ok += 1

        tubes = []
        for result in yolo(frame, conf=conf, verbose=False):
            for box in result.boxes:
                name = result.names[int(box.cls[0])]
                if name not in tube_classes:
                    continue
                xyxy = [float(v) for v in box.xyxy[0]]
                color = classify_hsv(cap_region(frame, xyxy))
                tubes.append((name, round(float(box.conf[0]), 2), color))
                if color:
                    tube_colors[color] = tube_colors.get(color, 0) + 1

        blobs = detect_cap_blobs(frame)
        for blob in blobs:
            blob_colors[blob["color"]] = blob_colors.get(blob["color"], 0) + 1

        frames_with_tube += bool(tubes)
        frames_with_blob += bool(blobs)
        print(f"frame {i + 1:>2}: yolo_tubes={tubes or '-'} blobs={[b['color'] for b in blobs] or '-'}")
        time.sleep(FRAME_DELAY_S)

    if not frames_ok:
        sys.exit("No frames grabbed — check camera source/credentials.")

    tube_rate = frames_with_tube / frames_ok
    blob_rate = frames_with_blob / frames_ok
    print("\n=== GATE V6 REPORT ===")
    print(f"frames grabbed:            {frames_ok}/{N_FRAMES}")
    print(f"YOLO tube detection rate:  {tube_rate:.0%}  (colors: {tube_colors or '-'})")
    print(f"HSV blob detection rate:   {blob_rate:.0%}  (colors: {blob_colors or '-'})")
    if tube_rate >= GATE_THRESHOLD:
        print(f"VERDICT: >= {GATE_THRESHOLD:.0%} → crop-bbox over YOLO stays PRIMARY.")
    else:
        print(f"VERDICT: < {GATE_THRESHOLD:.0%} → HSV blob path is PRIMARY "
              "(already implemented — no redesign needed).")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    argv = sys.argv[1:]
    model, classes, conf = "yolov8n.pt", None, 0.5
    if "--model" in argv:
        i = argv.index("--model")
        model = argv.pop(i + 1)
        argv.pop(i)
    if "--classes" in argv:
        i = argv.index("--classes")
        classes = [c.strip() for c in argv.pop(i + 1).split(",") if c.strip()]
        argv.pop(i)
    if "--conf" in argv:
        i = argv.index("--conf")
        conf = float(argv.pop(i + 1))
        argv.pop(i)
    main(argv[0], *(argv[1:3]), model=model, classes=classes, conf=conf)
