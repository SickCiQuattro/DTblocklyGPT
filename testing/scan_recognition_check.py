#!/usr/bin/env python3
"""Read-only snapshot + YOLO + cap-colour check against the real Canon camera.

Does NOT move the robot. Jog the arm by hand with the teach pendant to a
candidate scan pose, then run this to see exactly what YOLO recognizes from
that angle — same model/logic as vision_node.py's detection path, just fed
one snapshot instead of the 10 Hz ROS loop. Use it to tune SCAN_POSE
(backend/functions/calibration.py, _REAL_PROFILE).

The camera is fixed-mount, fixed-optics (no zoom/pan) — only the joint pose
changes what it sees. --ab compares stock YOLOv8n against an open-vocabulary
model (YOLOE/YOLO-World) on the SAME snapshot, so one run tells you whether a
model swap can recover a more comfortable (less joint-limit-straining) pose.

Run:
    poetry run python testing/scan_recognition_check.py
    poetry run python testing/scan_recognition_check.py --url http://192.168.0.90/-wvhttp-01-/image.cgi --user admin --pass password
    poetry run python testing/scan_recognition_check.py --out /tmp/scan_check.png
    poetry run python testing/scan_recognition_check.py --ab --model2 yoloe-11s-seg.pt \\
        --classes "test tube,medicine bottle,beaker,bowl"
"""
import argparse
import os
import sys
import time

import cv2
import numpy as np
import requests
from requests.auth import HTTPDigestAuth

sys.path.insert(0, os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "ros2_ws", "src", "cobotta_rest_api")))

# Same COCO classes vision_node.py runs the cap-colour pass on.
_TUBE_CLASSES = ("bottle", "cup")

DEFAULT_URL = "http://192.168.0.90/-wvhttp-01-/image.cgi"
DEFAULT_USER = "admin"
DEFAULT_PASS = "password"


def _grab(url: str, user: str, password: str):
    """Same HTTP-snapshot path as vision_node.VisionNode._grab."""
    auth = HTTPDigestAuth(user, password) if user else None
    resp = requests.get(url, auth=auth, timeout=5.0)
    resp.raise_for_status()
    frame = cv2.imdecode(np.frombuffer(resp.content, np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise RuntimeError("camera responded but frame did not decode — wrong URL/format?")
    return frame


def _resolve_weights(name):
    """Bare filename → repo-root path (matches existing yolov8n.pt convention); else pass through."""
    if os.sep not in name and not name.startswith("."):
        local = os.path.join(os.path.dirname(__file__), "..", name)
        if os.path.exists(local):
            return local
    return name


def _run_model(weights, frame, wb_frame, conf, classes, cap_color_available, label, out_path):
    """Load weights, infer once, print a report, save the annotated frame. Returns tube recall count."""
    from ultralytics import YOLO

    print(f"[{label}] loading {weights} ...")
    model = YOLO(_resolve_weights(weights))
    if classes:
        try:
            model.set_classes(classes)
        except AttributeError:
            print(f"      {weights} has no set_classes (not an open-vocabulary model) — ignoring --classes")

    t0 = time.monotonic()
    results = model(frame, conf=conf, verbose=False)
    infer_ms = (time.monotonic() - t0) * 1000

    detections = []
    for result in results:
        for box in result.boxes:
            class_id = int(box.cls[0])
            confidence = float(box.conf[0])
            class_name = result.names[class_id]
            xyxy = [float(v) for v in box.xyxy[0]]
            det = {"class": class_name, "confidence": round(confidence, 4), "bbox": xyxy}
            tube_classes = set(_TUBE_CLASSES) | (set(classes) if classes else set())
            if class_name in tube_classes and cap_color_available:
                from cobotta_rest_api.cap_color import cap_region, classify_hsv, sample_background_hue
                bg_hue = sample_background_hue(wb_frame, xyxy)
                color = classify_hsv(cap_region(wb_frame, xyxy), background_hue=bg_hue)
                if color:
                    det["color"] = color
            detections.append(det)

    print(f"      {infer_ms:.0f} ms inference, {len(detections)} detection(s):")
    if not detections:
        print("      (none — try a different angle/distance or lower --conf)")
    for det in detections:
        color_str = f" color={det['color']}" if "color" in det else ""
        print(f"      {det['class']:>16s}  conf={det['confidence']:.2f}{color_str}  "
              f"bbox={[round(v) for v in det['bbox']]}")

    annotated = results[0].plot()
    cv2.imwrite(out_path, annotated)
    print(f"      annotated frame saved to {out_path}")
    return detections


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                      formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--user", default=DEFAULT_USER)
    parser.add_argument("--pass", dest="password", default=DEFAULT_PASS)
    parser.add_argument("--image", default=None,
                         help="Load a previously-saved raw frame instead of fetching from --url — "
                              "lets you capture now and re-run recognition tests later without the "
                              "camera/robot. Use --save-raw to capture one.")
    parser.add_argument("--save-raw", default=None,
                         help="Just fetch a snapshot from --url, save it here unmodified, and exit "
                              "(no inference). Load it back later with --image.")
    parser.add_argument("--conf", type=float, default=0.35)
    parser.add_argument("--out", default="/tmp/scan_recognition_check.png",
                         help="Where to save the annotated frame")
    parser.add_argument("--model", default="yolov8n.pt", help="Weights to run (bare name resolves to repo root)")
    parser.add_argument("--ab", action="store_true",
                         help="Also run --model2 on the same snapshot and print both reports")
    parser.add_argument("--model2", default="yoloe-11s-seg.pt", help="Second model for --ab")
    parser.add_argument("--classes", default="",
                         help="Comma-separated class list passed to set_classes() on open-vocabulary "
                              "models (YOLOE/YOLO-World); ignored by stock YOLO checkpoints")
    args = parser.parse_args()
    classes = [c.strip() for c in args.classes.split(",") if c.strip()] or None

    if args.save_raw:
        print(f"Fetching snapshot from {args.url} ...")
        frame = _grab(args.url, args.user, args.password)
        cv2.imwrite(args.save_raw, frame)
        print(f"  saved raw frame to {args.save_raw} (no inference run)")
        return

    if args.image:
        print(f"Loading saved frame from {args.image} ...")
        frame = cv2.imread(args.image)
        if frame is None:
            print(f"  could not read {args.image}")
            return
    else:
        print(f"Fetching snapshot from {args.url} ...")
        frame = _grab(args.url, args.user, args.password)
    h, w = frame.shape[:2]
    print(f"  got {w}x{h} frame")

    try:
        from cobotta_rest_api.cap_color import normalize_white_balance
        # Cap-colour crops all come from this whitened copy — gray-world needs
        # a large, roughly-neutral sample to estimate a cast from, which only
        # the full frame gives. YOLO itself still sees the raw frame; bbox
        # geometry is colour-independent. Matches vision_node._run_yolo.
        wb_frame = normalize_white_balance(frame)
        cap_color_available = True
    except Exception as exc:
        print(f"  cap_color import failed ({exc}) — classes only, no cap colour")
        wb_frame = frame
        cap_color_available = False

    base, ext = os.path.splitext(args.out)
    _run_model(args.model, frame, wb_frame, args.conf, classes, cap_color_available,
               "A" if args.ab else "model", f"{base}_a{ext}" if args.ab else args.out)
    if args.ab:
        _run_model(args.model2, frame, wb_frame, args.conf, classes, cap_color_available, "B", f"{base}_b{ext}")


if __name__ == "__main__":
    main()
