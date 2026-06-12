import json
from threading import Thread

import cv2
import rclpy
from rclpy.node import Node
from std_msgs.msg import String


class VisionNode(Node):

    def __init__(self):
        super().__init__("vision_node")

        self._gesture_pub = self.create_publisher(String, "/human/gesture", 10)
        self._object_pub = self.create_publisher(String, "/vision/object_detected", 10)

        # Lazy-import heavy deps here so ROS2 init is not blocked
        from hand_gesture.engine import GestureEngine
        self._gesture_engine = GestureEngine()

        from ultralytics import YOLO
        self._yolo = YOLO("yolov8n.pt")

        self._cap = cv2.VideoCapture(0)
        self._frame_counter = 0

        if not self._cap.isOpened():
            self.get_logger().fatal(
                "VisionNode: webcam (index 0) unavailable — "
                "gesture and object detection will be skipped."
            )
            self._webcam_ok = False
        else:
            self._webcam_ok = True

        # 10 Hz timer
        self.create_timer(0.1, self._timer_callback)

    # ------------------------------------------------------------------
    # Timer callback — runs at 10 Hz
    # ------------------------------------------------------------------
    def _timer_callback(self):
        if not self._webcam_ok:
            self._publish_gesture("NONE")
            self._publish_detections([])
            return

        ret, frame = self._cap.read()
        if not ret:
            self.get_logger().warning("VisionNode: failed to read frame from webcam.")
            self._publish_gesture("NONE")
            self._publish_detections([])
            return

        self._frame_counter += 1

        # --- Gesture every frame ---
        try:
            _processed_frame, stable_gesture = self._gesture_engine.process(frame)
            if stable_gesture is None:
                gesture_label = "NONE"
            else:
                gesture_label = stable_gesture.upper().replace(" ", "_")
        except Exception as exc:  # noqa: BLE001
            self.get_logger().warning(f"VisionNode: gesture detection error: {exc}")
            gesture_label = "NONE"

        self._publish_gesture(gesture_label)

        # --- YOLO every 5 frames ---
        if self._frame_counter % 5 == 0:
            detections = self._run_yolo(frame)
            self._publish_detections(detections)

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
    def _publish_gesture(self, label: str):
        msg = String()
        msg.data = label
        self._gesture_pub.publish(msg)

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

    spin_thread = Thread(target=rclpy.spin, args=(node,), daemon=True)
    spin_thread.start()

    try:
        spin_thread.join()
    except KeyboardInterrupt:
        pass
    finally:
        rclpy.shutdown()
        spin_thread.join(timeout=2.0)
        try:
            node.destroy_node()
        except Exception:
            pass


if __name__ == "__main__":
    main()
