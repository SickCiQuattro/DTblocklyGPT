import json

import cv2
import numpy as np
import requests
from requests.auth import HTTPDigestAuth
import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from cobotta_rest_api.cap_color import (
    cap_region,
    classify_hsv,
    detect_cap_blobs,
    point_in_bbox,
)

# COCO classes that can stand in for a test tube; their bbox top gets a
# cap-colour classification pass.
_TUBE_CLASSES = ("bottle", "cup")


class VisionNode(Node):

    def __init__(self):
        super().__init__("vision_node")

        self._object_pub = self.create_publisher(String, "/vision/object_detected", 10)

        # A camera source is a USB index ("0"), a cv2 URL/path ("rtsp://…",
        # "/dev/video2"), or an HTTP snapshot URL ("http://…/image.cgi" — Canon WebView).
        self.declare_parameter("camera_source", "0")
        self.declare_parameter("camera_user", "")
        self.declare_parameter("camera_pass", "")
        # Optional fallback used automatically if the primary keeps failing (e.g. Canon
        # down → USB webcam "0"). Empty = no fallback.
        self.declare_parameter("camera_fallback", "")
        self.declare_parameter("camera_fallback_user", "")
        self.declare_parameter("camera_fallback_pass", "")
        # Switch to fallback after this many consecutive grab failures; retry the
        # primary every retry_primary_secs while running on the fallback.
        self.declare_parameter("max_failures", 6)
        self.declare_parameter("retry_primary_secs", 15.0)

        def p(name):
            return str(self.get_parameter(name).value)

        self._caps = []   # cv2.VideoCapture handles to release on shutdown
        self._sources = [self._build_source(
            p("camera_source"), p("camera_user"), p("camera_pass"), "primary")]
        if p("camera_fallback"):
            self._sources.append(self._build_source(
                p("camera_fallback"), p("camera_fallback_user"),
                p("camera_fallback_pass"), "fallback"))

        self._active = 0                 # index into self._sources
        self._fail = 0                   # consecutive failures on the active source
        self._max_failures = int(self.get_parameter("max_failures").value)
        # YOLO runs on every 5th 10 Hz tick (~2 Hz) → convert seconds to ticks.
        self._retry_ticks = max(1, int(float(self.get_parameter("retry_primary_secs").value) / 0.5))
        self._since_primary_try = 0

        # Lazy-import heavy deps here so ROS2 init is not blocked
        from ultralytics import YOLO
        self._yolo = YOLO("yolov8n.pt")

        self._frame_counter = 0
        self.create_timer(0.1, self._timer_callback)   # 10 Hz

    # ------------------------------------------------------------------
    # Source construction / grabbing
    # ------------------------------------------------------------------
    def _build_source(self, src, user, password, label):
        """Return a source descriptor for an HTTP-snapshot URL or a cv2 device."""
        if src.startswith("http://") or src.startswith("https://"):
            auth = HTTPDigestAuth(user, password) if user else None
            self.get_logger().info(f"VisionNode: {label} = HTTP snapshot '{src}'")
            return {"kind": "http", "url": src, "auth": auth, "label": label}
        cap = cv2.VideoCapture(int(src) if src.isdigit() else src)
        self._caps.append(cap)
        if not cap.isOpened():
            self.get_logger().warning(f"VisionNode: {label} device '{src}' not open (yet).")
        else:
            self.get_logger().info(f"VisionNode: {label} = device '{src}'")
        return {"kind": "cv2", "cap": cap, "label": label}

    def _grab(self, source):
        """Return one BGR frame from a source, or None on failure."""
        try:
            if source["kind"] == "http":
                resp = requests.get(source["url"], auth=source["auth"], timeout=2.0)
                resp.raise_for_status()
                frame = cv2.imdecode(np.frombuffer(resp.content, np.uint8), cv2.IMREAD_COLOR)
            else:
                ok, frame = source["cap"].read()
                frame = frame if ok else None
            return frame
        except Exception as exc:  # noqa: BLE001
            self.get_logger().warning(f"VisionNode: {source['label']} grab error: {exc}")
            return None

    # ------------------------------------------------------------------
    # Timer callback — runs at 10 Hz, infers every 5th frame (~2 Hz)
    # ------------------------------------------------------------------
    def _timer_callback(self):
        self._frame_counter += 1
        if self._frame_counter % 5 != 0:
            return

        # While on the fallback, periodically probe the primary and switch back.
        if self._active != 0:
            self._since_primary_try += 1
            if self._since_primary_try >= self._retry_ticks:
                self._since_primary_try = 0
                frame = self._grab(self._sources[0])
                if frame is not None:
                    self.get_logger().info("VisionNode: primary recovered → switching back")
                    self._active = 0
                    self._fail = 0
                    self._publish_detections(self._run_yolo(frame))
                    return

        frame = self._grab(self._sources[self._active])
        if frame is None:
            self._fail += 1
            self._publish_detections([])
            if self._fail >= self._max_failures and len(self._sources) > 1:
                self._active = (self._active + 1) % len(self._sources)
                self._fail = 0
                self._since_primary_try = 0
                self.get_logger().warning(
                    f"VisionNode: source failed → switching to {self._sources[self._active]['label']}")
            return

        self._fail = 0
        self._publish_detections(self._run_yolo(frame))

    # ------------------------------------------------------------------
    # YOLO inference
    # ------------------------------------------------------------------
    def _run_yolo(self, frame):
        try:
            results = self._yolo(frame, conf=0.5, verbose=False)
            h_img, w_img = frame.shape[:2]
            detections = []
            for result in results:
                for box in result.boxes:
                    class_id = int(box.cls[0])
                    confidence = float(box.conf[0])
                    class_name = result.names[class_id]
                    xyxy = [float(v) for v in box.xyxy[0]]
                    detection = {
                        "class": class_name,
                        "confidence": round(confidence, 4),
                        "bbox": [round(v, 1) for v in xyxy],
                        "center": [
                            round((xyxy[0] + xyxy[2]) / 2 / w_img, 4),
                            round((xyxy[1] + xyxy[3]) / 2 / h_img, 4),
                        ],
                    }
                    if class_name in _TUBE_CLASSES:
                        color = classify_hsv(cap_region(frame, xyxy))
                        if color:
                            detection["color"] = color
                    detections.append(detection)
            detections.extend(self._blob_detections(frame, detections))
            return detections
        except Exception as exc:  # noqa: BLE001
            self.get_logger().warning(f"VisionNode: YOLO inference error: {exc}")
            return []

    def _blob_detections(self, frame, yolo_detections):
        """HSV blob pass for caps YOLO cannot see (gate-V6 fallback, Gazebo).

        Blobs whose centre falls inside a same-colour tube bbox are dropped —
        that cap is already represented by the enriched YOLO detection.
        """
        tube_boxes = [d for d in yolo_detections if d["class"] in _TUBE_CLASSES]
        blobs = []
        for blob in detect_cap_blobs(frame):
            duplicate = any(
                d.get("color") == blob["color"]
                and point_in_bbox(blob["center"], d["bbox"], frame.shape)
                for d in tube_boxes
            )
            if not duplicate:
                blobs.append({"class": "cap", "confidence": 1.0, "source": "hsv", **blob})
        return blobs

    # ------------------------------------------------------------------
    # Publishers
    # ------------------------------------------------------------------
    def _publish_detections(self, detections: list):
        msg = String()
        msg.data = json.dumps({"detections": detections})
        self._object_pub.publish(msg)

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------
    def destroy_node(self):
        for cap in self._caps:
            if cap.isOpened():
                cap.release()
        super().destroy_node()


def main(args=None):
    rclpy.init(args=args)
    node = VisionNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
