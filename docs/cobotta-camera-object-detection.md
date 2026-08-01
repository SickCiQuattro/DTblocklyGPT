# COBOTTA — Connect Robot, Connect Camera, Test Object Detection

Practical end-to-end guide: bring up the physical COBOTTA, attach a camera to the
object-detection pipeline, and verify YOLO detections. Companion to
[cobotta-physical-testing.md](cobotta-physical-testing.md) (deep connection detail) and
[cobotta-connection.md](cobotta-connection.md) (per-platform networking).

> Verified against the code: `vision_node.py`, `vision_mapping.py`, `bridge_node_ROS.py`,
> `blueprints/flask_api.py`, `simulate.py`. Network values from the DENSO COBOTTA guide:
> robot `192.168.0.1`, camera `192.168.0.90`, client PC `192.168.0.100`.

---

## How vision actually works (read first)

There are **two separate camera concepts** — don't confuse them:

| Stream | Source | Purpose | Where seen |
|---|---|---|---|
| `:8080` web_video_server `/camera/image_raw` | **Gazebo** sim camera (ros_gz bridge) | visual twin feed | browser `http://localhost:8080` |
| `/vision/object_detected` | **`vision_node`** reading `cv2.VideoCapture(camera_source)` | YOLO **object detection** | `/api/vision/state` (JSON) |

`vision_node` publishes **only detections (JSON)**, not video. So "seeing" detection =
querying `/api/vision/state`, not the `:8080` stream.

**Detection data flow** (verified):
```
vision_node (YOLOv8n, 10 Hz / every 5th frame, conf 0.5)
   └─ /vision/object_detected  {"detections":[{"class":"bottle","confidence":..}]}
        └─ bridge_node_ROS._object_callback → cache
             └─ GET /api/vision/state  {"gesture":..,"detections":[..]}
                  └─ simulate.py _wait_for_condition (find_object block)
```

Object names are mapped to **COCO classes** by `vision_mapping.to_coco_class`
(e.g. `flask`/`provetta`/`bottiglia` → `bottle`, `tappo` → `cup`). A `find_object` on an
app object named "flask" is satisfied when YOLO sees a **bottle**. yolov8n knows the 80
COCO classes only.

---

## Part 1 — Connect the robot

Full detail in [cobotta-physical-testing.md](cobotta-physical-testing.md). Short form:

1. **PoE switch** on; robot + camera + PC cabled to it. Client IP `192.168.0.100/24`
   (Mac en6 static + NAT, or WSL host). Verify: `nc -vz 192.168.0.1 5007`.
2. **Executable Token** set once via a Teach Pendant (Android RC8 RemoteTP / desktop
   Virtual TP / Android emulator on Mac) → Ethernet + `192.168.0.100`, or **Any**.
   Required for motor-on (`0x83501029` otherwise). See §6b of the testing doc.
3. Robot **green LED** (Normal Mode), e-stop reachable.
4. Launch (WSL/VM): `cd ros2_ws/Cobotta && BCAP_HOST=192.168.0.1 EXT_SPEED=20 bash launch_physical.sh`
   → expect `B-CAP connected`.
5. Django: `DRIVE_HARDWARE=1 poetry run python manage.py runserver`.

---

## Part 2 — Connect a camera to the detection pipeline

`vision_node`'s `camera_source` is an OpenCV source: a **device index** (`0`, `1`, …), a
**device path** (`/dev/video2`), or a **stream URL** (`rtsp://…`). Pick one:

### Option A — USB webcam (supported, reliable)
Point a USB camera at the workspace.
```bash
ls /dev/video*                 # find the index/path (Linux)
# v4l2-ctl --list-devices       # nicer listing if installed
```
Use that index/path as `camera_source` (Part 3). This is the default and the path the
project is built around (the "wrist cam").

### Option B — Canon camera of the COBOTTA (192.168.0.90) — cross-platform ✅ VERIFIED

> **Verified on hardware (2026-07-01):** Canon WebView snapshot →
> `vision_node` (HTTP mode) → YOLO detected `person` (conf 0.75) via `/api/vision/state`.

The integrated Canon is a **network** camera powered by the **PoE switch** (touch test:
warm = on). `vision_node` reads it over HTTP (no COM, works Win + Linux). `camera_source`
accepts three forms: USB index, an `rtsp://`/`/dev/...` cv2 URL/path, or an **`http://`
snapshot URL**.

**Confirmed working endpoint (this camera):**
```bash
nc -vz 192.168.0.90 80        # HTTP (Canon WebView) — open
nc -vz 192.168.0.90 554       # RTSP — refused (no RTSP on this model)
# single-JPEG snapshot — Digest auth, lab creds admin:password:
curl --digest -u admin:password -o t.jpg "http://192.168.0.90/-wvhttp-01-/image.cgi"
```
- The working CGI is **`/-wvhttp-01-/image.cgi`** (returns JPEG 1920×1080). Note:
  `GetOneShot`/`GetStillImage`/`GetLiveImage` return **400** on this model — use
  `image.cgi`.
- Auth is **HTTP Digest**; credentials **`admin` / `password`** (lab default; change if
  your camera differs). Root `/` redirects to `/admin/network.html` (camera config).
- Pass them to `vision_node` via `camera_user` / `camera_pass` (it uses Digest). See Part 3.

**B2 — via the ORiN Canon provider (Windows only):** `get_photo`/`acquire_photo`
([robot.py](../backend/functions/robot.py)) drive the Canon over COM (`pywin32`). This is
the **legacy still-photo / contour** feature, **not** the YOLO pipeline, and works only
when Django runs on a Windows host (see §11 of the testing doc). It does not feed
`vision_node`. Use B1 for detection.

---

## Part 3 — Run object detection and test it

**`launch_physical.sh` can start `vision_node` on the Canon** (env
`CAMERA_SOURCE` / `CAMERA_USER` / `CAMERA_PASS`, defaults = Canon `image.cgi` +
`admin:password`) — but `ENABLE_VISION` defaults to **false**, so it does NOT
auto-start; pass `ENABLE_VISION=1` explicitly. The commands below are for
**standalone** runs / a different camera.

`vision_node` needs the **Poetry** environment (ultralytics/YOLO). The model
`yolov8n.pt` auto-downloads on first run (needs internet once).

> **Gotcha (verified):** `poetry run ros2 run cobotta_rest_api vision_node` FAILS with
> `ModuleNotFoundError: ultralytics` — `ros2 run` re-execs the entry point via the
> **system python** (shebang), not the Poetry venv. **Launch the file directly with the
> Poetry python** instead:

### Start the detection node (identical on Windows/WSL and Linux)
```bash
cd /home/filippo/DTblocklyGPT
source /opt/ros/jazzy/setup.bash && source ros2_ws/install/setup.bash
VN=ros2_ws/src/cobotta_rest_api/cobotta_rest_api/vision_node.py

# Canon HTTP snapshot (this camera) — VERIFIED:
poetry run python $VN --ros-args \
    -p camera_source:=http://192.168.0.90/-wvhttp-01-/image.cgi \
    -p camera_user:=admin -p camera_pass:=password

# USB webcam at index 0:
poetry run python $VN --ros-args -p camera_source:=0

# Canon RTSP (only if the model exposes it):
poetry run python $VN --ros-args -p camera_source:=rtsp://192.168.0.90/rtpstream/config1
```
`camera_source` auto-detects the mode: digits → USB; `http(s)://` → snapshot polling
(~2 Hz); anything else → cv2 URL/path (RTSP, `/dev/video*`). The node must be able to
reach `192.168.0.90` (same robot LAN — Mac NAT route / WSL mirrored cover
`192.168.0.0/24`). Healthy log: no `camera source unavailable` fatal; HTTP mode logs
`HTTP snapshot source '...'`. A bad source → empty detections, rest of the stack runs.

### Test 1 — raw detections via the API (fastest)
Put a known object (e.g. a **bottle**) in view, then:
```bash
curl -s http://localhost:5000/api/vision/state | python3 -m json.tool
```
Expect something like:
```json
{"gesture": "NONE", "detections": [{"class": "bottle", "confidence": 0.87}], "gesture_age_s": ...}
```
Move the object in/out of frame and re-curl — `detections` should change. This proves
camera → vision_node → bridge → API.

### Test 2 — blocking wait endpoint
```bash
curl -s "http://localhost:5000/api/vision/wait-object?target_class=bottle&timeout=15"
# {"detected": true, "target_class": "bottle"}
```

### Test 3 — end-to-end via a Blockly task (`find_object`)
1. In the app, create an object whose name maps to a COCO class (e.g. name it
   **"flask"** → maps to `bottle`; or add your term to `_OBJECT_TO_COCO` in
   [vision_mapping.py](../backend/functions/vision_mapping.py)).
2. Build a task using a **find_object** condition (e.g. inside a `when` / `human_action`
   confirm), Simulate it.
3. `simulate.py` calls `_wait_for_condition`, polling `/api/vision/state` until the COCO
   class appears (timeout `CONDITION_TIMEOUT_S`, default 30 s) — then the branch runs.
   Watch the Django log: `[CONDITION] Waiting for object: 'flask' → COCO 'bottle' …` then
   `Object 'flask' detected!`.

### Tuning
- Detection rate: 10 Hz timer, YOLO every 5th frame (~2 inferences/s) — edit
  `vision_node._timer_callback`.
- Confidence: `conf=0.5` in `_run_yolo`.
- Name→class: extend `_OBJECT_TO_COCO` in `vision_mapping.py`.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `vision_node` "camera source unavailable" | wrong index/path; USB cam not attached; RTSP URL wrong/closed. `ls /dev/video*`. |
| `/api/vision/state` always empty detections | object not a COCO class (check mapping); conf < 0.5; camera dark; node not running. |
| Canon `192.168.0.90` unreachable | not powered — needs the **PoE switch** (direct PC↔robot leaves it dead); confirm warm. |
| `find_object` never fires | name doesn't map to a COCO class → add to `_OBJECT_TO_COCO`; check Django log for the COCO translation. |
| `:8080` shows sim camera, not my webcam | expected — `:8080` is the Gazebo camera; YOLO uses a separate `camera_source`. |
| YOLO download fails | first run needs internet for `yolov8n.pt`; pre-place the file in the working dir. |
| `ModuleNotFoundError: ultralytics` at start | you used `poetry run ros2 run …` — its shebang uses system python. Launch with `poetry run python <vision_node.py>` (see Part 3). |
| Snapshot `curl` → `400` | wrong CGI for this model — use `/-wvhttp-01-/image.cgi`, not `GetOneShot`. |
| Snapshot `curl` → `401` | Digest auth — `--digest -u admin:password` (camera WebView creds). |

---

## References
- Detectable classes vs app objects: [vision-object-catalog.md](internal/vision-object-catalog.md).
- Connection / token / network: [cobotta-physical-testing.md](cobotta-physical-testing.md),
  [cobotta-connection.md](cobotta-connection.md).
