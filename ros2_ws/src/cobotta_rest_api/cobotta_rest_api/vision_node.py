import json

import cv2
import numpy as np
import requests
import rclpy
from rclpy.node import Node
from std_msgs.msg import String


class VisionNode(Node):

    def __init__(self):
        super().__init__("vision_node")

        self._object_pub = self.create_publisher(String, "/vision/object_detected", 10)

        # camera_source: USB index ("0"), a cv2 URL/path ("rtsp://…", "/dev/video2"),
        # or an HTTP snapshot URL ("http://…/GetOneShot") — e.g. the COBOTTA Canon cam.
        self.declare_parameter("camera_source", "0")
        # Optional HTTP auth for the snapshot URL (Canon WebView; empty = none).
        self.declare_parameter("camera_user", "")
        self.declare_parameter("camera_pass", "")
        src = str(self.get_parameter("camera_source").value)
        user = str(self.get_parameter("camera_user").value)
        password = str(self.get_parameter("camera_pass").value)

        self._http_url = None
        self._http_auth = None
        self._cap = None

        if src.startswith("http://") or src.startswith("https://"):
            # HTTP snapshot mode: poll a single-JPEG endpoint and decode each frame.
            self._http_url = src
            if user:
                # Canon WebView typically uses Digest; falls back cleanly if Basic.
                self._http_auth = requests.auth.HTTPDigestAuth(user, password)
            self._cam_ok = True
            self.get_logger().info(f"VisionNode: HTTP snapshot source '{src}'")
        else:
            self._cap = cv2.VideoCapture(int(src) if src.isdigit() else src)
            self._cam_ok = self._cap.isOpened()
            if not self._cam_ok:
                self.get_logger().fatal(
                    f"VisionNode: camera source '{src}' unavailable — "
                    "object detection will be skipped."
                )

        # Lazy-import heavy deps here so ROS2 init is not blocked
        from ultralytics import YOLO
        self._yolo = YOLO("yolov8n.pt")

        self._frame_counter = 0

        # 10 Hz timer
        self.create_timer(0.1, self._timer_callback)

    # ------------------------------------------------------------------
    # Timer callback — runs at 10 Hz
    # ------------------------------------------------------------------
    def _timer_callback(self):
        if not self._cam_ok:
            self._publish_detections([])
            return

        self._frame_counter += 1

        if self._http_url is not None:
            # HTTP snapshot: fetch only on the YOLO tick (~2 Hz, gentle on the camera).
            if self._frame_counter % 5 != 0:
                return
            frame = self._grab_http()
            if frame is None:
                self._publish_detections([])
                return
        else:
            ret, frame = self._cap.read()
            if not ret:
                self.get_logger().warning("VisionNode: failed to read frame from camera.")
                self._publish_detections([])
                return
            # --- YOLO every 5 frames ---
            if self._frame_counter % 5 != 0:
                return

        self._publish_detections(self._run_yolo(frame))

    # ------------------------------------------------------------------
    # HTTP snapshot grab (e.g. Canon WebView /-wvhttp-01-/GetOneShot)
    # ------------------------------------------------------------------
    def _grab_http(self):
        try:
            resp = requests.get(self._http_url, auth=self._http_auth, timeout=2.0)
            resp.raise_for_status()
            arr = np.frombuffer(resp.content, dtype=np.uint8)
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if frame is None:
                self.get_logger().warning("VisionNode: HTTP snapshot decode failed.")
            return frame
        except Exception as exc:  # noqa: BLE001
            self.get_logger().warning(f"VisionNode: HTTP snapshot fetch error: {exc}")
            return None

    # ------------------------------------------------------------------
    # YOLO inference
    # ------------------------------------------------------------------
    def _run_yolo(self, frame):
        try:
            results = self._yolo(frame, conf=0.5, verbose=False)
            detections = []
            for result in results:
                for box in result.boxes:
                    class_id = int(box.cls[0])
                    confidence = float(box.conf[0])
                    class_name = result.names[class_id]
                    detections.append({"class": class_name, "confidence": round(confidence, 4)})
            return detections
        except Exception as exc:  # noqa: BLE001
            self.get_logger().warning(f"VisionNode: YOLO inference error: {exc}")
            return []

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
        if self._cap is not None and self._cap.isOpened():
            self._cap.release()
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
