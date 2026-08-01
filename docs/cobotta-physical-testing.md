# Cobotta Physical Robot — Connect & Test Runbook

End-to-end procedure to connect the physical Denso Cobotta and verify the whole
stack, from network reachability up to a full pick→place on the real arm.

Pairs with:
- [cobotta-connection.md](cobotta-connection.md) — networking detail (VM bridging, USB-C Ethernet)
- [cobotta-calibration.md](internal/cobotta-calibration.md) — pick/place geometry calibration
- [ik_pick_place_analysis.md](internal/ik_pick_place_analysis.md) — IK pipeline internals

> **Golden safety rule:** keep the teach-pendant **deadman / e-stop in hand** at all
> times. `/api/stop` halts only the Gazebo waypoint stream — it does **not** stop the
> real arm. The real arm is stopped by the pendant deadman or e-stop only.

---

## 0. What runs where

All four stack processes run inside Linux (VM/WSL). The arm is reached over TCP
(B-CAP/ORiN, pure-Python sockets → works on Linux). Only the integrated **Canon
camera** (`get_photo`/`acquire_photo`) is Windows-only COM and is **not used** by the
twin; vision uses `vision_node` + a USB/stream cam, which works on Linux.

```
Django (DRIVE_HARDWARE=1)
  ├─ /api/move-path   ─► flask_node ─► JointTrajectory ─► arm_controller (ros2_control) ─► Gazebo (twin)
  └─ /api/move-target ─► flask_node ─► cobotta_node ─TCP─► RC8 192.168.0.1:5007 (real arm)
cobotta_node ─► /cobotta/joint_states_real ─► flask_node ─► /api/actual-joints-real   # closed loop (IK seed)
vision_node  ─► /vision/object_detected    ─► flask_node
```

The twin is driven by **ros2_control** (`gz_ros2_control` + `arm_controller` /
`gripper_controller`), not the old per-joint `gazebo_command_node` / `gazebo_state_node`
(removed). `/joint_states` comes from `joint_state_broadcaster`.

---

## 1. Robot-side prerequisites (physical cell)

1. **PoE switch** powered; robot + camera + PC all cabled into it (the switch powers
   the Canon camera over Ethernet — a direct PC↔robot cable leaves the camera dead).
2. COBOTTA powered on, **e-stop released**, **green LED** (Normal Mode, motors ready).
3. b-CAP/ORiN provider on the RC8, TCP port **5007**; robot at **192.168.0.1**.
4. Executable Token set to this client (`192.168.0.100`) or "Any" — see §6b.
5. Work area clear; no object at the pick spot yet (first run is a dry run).
6. Keep the wrist enable / e-stop reachable. Start in **low speed**.

---

## 2. Network — make the robot reachable from Linux

Robot LAN is `192.168.0.0/24`: robot `192.168.0.1`, Canon camera `192.168.0.90`,
client PC **`192.168.0.100`** (DENSO guide convention — use this so the executable
token never needs re-editing per station). Cabling: robot + camera + PC all into a
**PoE switch** (the camera is powered over Ethernet by the switch).

Two ways to give the Linux VM access; **NAT-via-host is what we use** (keeps the VM's
internet, so it doesn't fight the uni Wi-Fi which is a different subnet, e.g. 10.x):

**A — NAT via the Mac host (recommended; no bridging, no second NIC):**
```bash
# Mac: USB-C Ethernet adapter (e.g. en6) → static IP on the robot LAN
#   System Settings → Network → <adapter> → Manually: 192.168.0.100 / 255.255.255.0 / no router
# Mac: route the VM subnet out the robot NIC
sudo sysctl -w net.inet.ip.forwarding=1
echo 'nat on en6 from 192.168.64.0/24 to any -> (en6)' | sudo pfctl -ef -
```
The VM keeps its shared NAT (internet) and reaches the robot via the default route →
Mac → en6. Through NAT the controller sees the client as `192.168.0.100` (the en6 IP),
which is why the token must be `192.168.0.100` (or "Any"). Adjust `en6` to your
adapter's BSD name (`ifconfig | grep -B5 192.168.0.100`).

**B — bridge the VM NIC to the USB adapter** (UTM Apple Virtualization often won't
bridge a USB adapter; QEMU backend can). Then give the VM a static `192.168.0.101/24`.

Verify from the VM:
```bash
nc -vz 192.168.0.1 5007      # must print "succeeded" / "open"
```
If this fails, **stop here** — fix networking first (`launch_physical.sh` also
pre-checks this and aborts if unreachable). See also
[cobotta-connection.md](cobotta-connection.md).

---

## 3. Build the workspace (after any cobotta_node.py change)

```bash
cd ros2_ws
source /opt/ros/jazzy/setup.bash
source .venv/bin/activate          # venv with --system-site-packages
colcon build --packages-select cobotta_rest_api my_robot_interfaces
source install/setup.bash
```

> Rebuild is **mandatory** after editing `cobotta_node.py` / interfaces — the running
> node uses the installed copy, not the source.

---

## 4. Launch the stack (3 terminals)

### Terminal 1 — full physical stack (Gazebo twin + real arm)

```bash
cd ros2_ws/Cobotta
BCAP_HOST=192.168.0.1 EXT_SPEED=20 bash launch_physical.sh
```

`launch_physical.sh` builds `cobotta_rest_api` and delegates to
`launch/cobotta_ros2_control.launch.py` with `hardware:=true`: it starts `gz sim` +
`robot_state_publisher` + `ros_gz_bridge` (clock/camera) + the controller spawners
(`joint_state_broadcaster`, `arm_controller`, `gripper_controller`) + `flask_node` +
`polling_socket_node` + `web_video_server` (camera stream :8080), and `cobotta_node`
with `enable_hardware:=true` (provider `CaoProv.DENSO.VRC`). On connect, `cobotta_node`
calls `TakeArm` / `Motor` / `ExtSpeed`.

Watch for: `B-CAP connected (ExtSpeed=20)`, `serving /cobotta/move_target`, and all
three controllers `active` (`ros2 control list_controllers`).

### Terminal 2 — Django (hardware profile)

```bash
DRIVE_HARDWARE=1 poetry run python manage.py runserver
```

`DRIVE_HARDWARE=1` does two things: `simulate.py` forwards each key pose to
`/api/move-target` (real arm), and `calibration.py` selects `_REAL_PROFILE`. **Must be
set** or moves stay sim-only.

### Terminal 3 — frontend

```bash
npm start        # http://localhost:3000
```

### (Optional) Terminal 4 — vision node (only if testing find_object/gesture)

`launch_physical.sh` can start it for you: `ENABLE_VISION=1 bash launch_physical.sh`
(defaults to the Canon at `192.168.0.90`; override `CAMERA_SOURCE`/`CAMERA_USER`/`CAMERA_PASS`).

Standalone — run the **file** with `poetry run python`, **not** `ros2 run`: ultralytics +
mediapipe live in the Poetry env, so the ROS system python ImportErrors them.
```bash
poetry run python ros2_ws/src/cobotta_rest_api/cobotta_rest_api/vision_node.py \
    --ros-args -p camera_source:=<device-index-or-URL>
```

---

## 5. Graduated test sequence — DO IN ORDER

Each step must pass before the next. Stop on the first failure.

### 5.1 Reachability + state read (no motion)

```bash
nc -vz 192.168.0.1 5007
python3 testing/bcap_probe.py 192.168.0.1 5007             # read-only b-CAP link test, no motion
curl -s http://localhost:5000/api/actual-joints-pos  | python3 -m json.tool   # twin (Gazebo)
curl -s http://localhost:5000/api/actual-joints-real | python3 -m json.tool   # real arm (closed loop)
```
`actual-joints-pos` = twin state (7 numbers: j1..j6, hand). `actual-joints-real` =
physical encoders — `{"available": true, "position": [j1..j6 deg]}` when `cobotta_node`
is connected. `available:false` means no hardware feed yet.

### 5.2 cobotta_node connected

In Terminal 1 confirm `B-CAP connected`. Then:
```bash
ros2 service list | grep move_target          # /cobotta/move_target present
```
A `hardware disabled` reply later means the B-CAP connect failed — recheck network /
e-stop / port.

### 5.3 Single gripper move (smallest real motion)

Hand-only target — arm does not move, only gripper. Hand in hand on the deadman:
```bash
curl -s -X POST http://localhost:5000/api/move-target \
  -H 'Content-Type: application/json' \
  -d '{"hand_only": true, "hand": 30}'        # open
curl -s -X POST http://localhost:5000/api/move-target \
  -H 'Content-Type: application/json' \
  -d '{"hand_only": true, "hand": 0}'         # close
```
Expect `{"ok": true, ...}`. Gripper opens/closes on the real arm. If `ok:false`,
read the cobotta_node log (the message to the client is intentionally generic).

### 5.4 Single small arm move (low speed)

Move close to home, small delta. **Joint values are clamped** to URDF limits by the
bridge; still, choose a pose you know is safe and collision-free:
```bash
curl -s -X POST http://localhost:5000/api/move-target \
  -H 'Content-Type: application/json' \
  -d '{"j1":0,"j2":20,"j3":100,"j4":0,"j5":60,"j6":0,"hand":30}'
# reorient wrist (camera up)
curl -s -X POST http://localhost:5000/api/move-target \
  -H 'Content-Type: application/json' \
  -d '{"j1":0,"j2":20,"j3":100,"j4":0,"j5":0,"j6":0,"hand":30}'
# scan pose (look at table)
curl -s -X POST http://localhost:5000/api/move-target \
  -H 'Content-Type: application/json' \
  -d '{"j1":0,"j2":30,"j3":70,"j4":0,"j5":80,"j6":0,"hand":30}'
```
Watch the real arm track the Gazebo twin. Keep `EXT_SPEED=20`. If anything looks
wrong → deadman immediately.

**Closed-loop check:** after a move, `actual-joints-real` should read the target back
(the encoders confirm the arm arrived):
```bash
curl -s http://localhost:5000/api/actual-joints-real | python3 -m json.tool
# after [0,20,100,0,60,0] → position ≈ [0, 20, 100, 0, 60, 0]
```

### 5.5 Calibration check (dry run, no object)

Build a minimal task in the UI: **pick → place** (one object, one location), or run
the offline IK regression first:
```bash
poetry run python -m pytest testing/test_ik_regression.py -v   # offline, no arm
```
Then **Simulate** the pick→place task with **no real object present**. Verify the arm
descends to the calibrated pick spot and the place slot. If geometry is off, calibrate
per [cobotta-calibration.md](internal/cobotta-calibration.md) and edit `_REAL_PROFILE` in
[calibration.py](../backend/functions/calibration.py) — no `simulate.py` edits needed.

### 5.6 Full pick→place with object

Place a real object at the calibrated pick spot (vision gates presence, **not**
position — manual placement required). Run **Simulate** from the UI. Confirm grasp →
lift → carry → place → home.

### 5.7 Loops / conditions (optional)

- `repeat N` re-picks the **same** spot — the real cell does not replenish, so put a
  `human_action` (refill) step inside the loop body (see calibration doc).
- `find_object` / `gesture` need Terminal 4 (vision_node) running.
- `MAX_LOOP_ITERATIONS` env caps loop iterations (default 10).

---

## 6. Stopping

| To stop… | Do this |
|---|---|
| The **real arm** immediately | Teach-pendant **deadman / e-stop** |
| The Gazebo waypoint stream | UI **Stop**, or `curl -X POST http://localhost:5000/api/stop` |
| The whole stack | `Ctrl+C` in Terminal 1 (launch_physical.sh cleans up) |

`/api/stop` sets `SIMULATION_STOP_EVENT` (parser aborts within ~0.1 s) and pauses
Gazebo — but the real arm finishes its current PTP. Use the pendant for a true stop.

---

## 6b. B-CAP servo-on sequence (COBOTTA) — what cobotta_node does

The physical COBOTTA needs a specific ORiN/b-CAP bring-up before motors can turn
on. `cobotta_node._connect()` performs it in this order (verified on hardware):

1. `service_start("")`
2. `controller_connect("", "CaoProv.DENSO.VRC", "localhost", "")` — provider is
   **VRC** even for the real RC8/COBOTTA over b-CAP TCP (RC8 → E_INVALIDARG).
3. `controller_getrobot(hCtrl, "Arm0")`
4. **pre-clear** (controller): `ManualResetPreparation` then `ClearError` — needed
   so a latched error (yellow LED) doesn't block TakeArm
   (`0x81501025` "command not available while an error occurs").
5. `robot_execute(hRobot, "TakeArm", [0,0])`
6. **servo prep (ROBOT-level, not controller!):** `robot ManualResetPreparation`
   then `robot MotionPreparation` — else Motor-on fails `0x81501069`
   "Operation preparation is necessary".
7. `robot Motor [1,0]` — **requires the Executable Token** (see below).
8. `robot ExtSpeed <n>`.

Decoded error reference (from the controller's own `GetErrorDescription`):

| HRESULT | Meaning |
|---|---|
| `0x81501069` | Operation preparation is necessary (run MotionPreparation first). |
| `0x83500372` | Run ManualResetPreparation before MotionPreparation / ClearError. |
| `0x81501025` | Command not available while an error occurs (clear the yellow first). |
| `0x83501029` | Set IP address for the executable token (see Executable Token). |
| `0x80070057` | E_INVALIDARG — wrong provider / wrong handle (controller vs robot) / bad param. |

LED meaning observed: **green** = fixed/ready (connect in this state), **white** =
preparing, **yellow** = error (recover with ManualResetPreparation + ClearError, or
press/release the FNC button).

### Executable Token (required for Motor-on)

`Motor [1,0]` fails `0x83501029` until this client holds the controller's
**Executable Token** — a DENSO safety setting deciding who may power motors and
command motion. Values: **TP / I/O / Ethernet / Any**. It is **not settable from
b-CAP code** (the official DENSO samples contain no token command) — it must be set
once in the controller config via a Teach Pendant. It then persists.

**Set it with the Android virtual TP (no Windows needed):**
1. App **RC8 RemoteTP** (`com.denso_wave.rc8.remotetp`) on a device that can reach
   `192.168.0.1` (Android on the robot LAN, or the Virtual TP desktop in ORiN2 SDK).
2. Login profile **Programmer**, password **`5596045`**.
3. `F6 Setting → F5 Communication and Token → F1 Executable Token`:
   - **Ethernet** → `F5 Edit` → IP **`192.168.0.100`** (our client IP via NAT), or
   - **Any** (simplest — no IP, works regardless of NAT/bridge).
4. `F2 Network and Permission → Permission → Read/Write` (needed for Ethernet b-CAP).

The token is only needed for motor-on / program start — not for reading/writing
variables. Until it is set, the full sequence above runs and only Motor-on is blocked.

### Recover from a yellow LED

```bash
# clears latched error; reads state (no TakeArm, no motion)
python3 testing/bcap_probe.py 192.168.0.1 5007
```
Or press and release the **FNC** button on the arm → returns to green.

---

## 7. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `nc` to 5007 fails | Mac en6 not `192.168.0.100`; missing `pfctl` NAT / `ip.forwarding`; robot off / e-stop. See §2. |
| launch_physical aborts "Cannot reach robot" | same as above — fix network before launch. |
| `move_target` returns `hardware disabled` | `cobotta_node` B-CAP connect failed; check Terminal 1 log, port 5007, e-stop. |
| `move_target` `ok:false`, generic message | read **cobotta_node log** (raw B-CAP error is logged there, not returned). |
| Connect fails at `[7/8] Motor on` `0x83501029` | Executable Token not held — set it to "Any" (or Ethernet + `192.168.0.100`) in COBOTTA config. See §6b. |
| Connect fails at TakeArm `0x81501025` | Latched error (yellow); pre-clear runs automatically, or recover per §6b. |
| Motor-on `0x81501069` | Missing servo prep — fixed by `cobotta_prep` (on by default). |
| Arm moves in sim but not real | Django not started with `DRIVE_HARDWARE=1`. |
| Connect hangs ~ minutes on bad IP | should now fail in ~5 s (`bcap_connect_timeout`); rebuild workspace if not. |
| Long PTP times out mid-move | raise `bcap_timeout` (op timeout, default 120 s) param on cobotta_node. |
| Pick/place geometry wrong | calibrate `_REAL_PROFILE`, [cobotta-calibration.md](internal/cobotta-calibration.md). |
| `get_photo` fails on Linux | expected — Canon camera is Windows-only COM; not needed for the twin. |

---

## 8. cobotta_node parameters (reference)

Set via `--ros-args -p name:=value` (launch_physical.sh sets the first four):

| Param | Default | Meaning |
|---|---|---|
| `enable_hardware` | `false` | Must be `true` to open the B-CAP connection. |
| `bcap_host` | `192.168.0.1` | RC8 IP. |
| `bcap_port` | `5007` | B-CAP TCP port. |
| `ext_speed` | `20` | RC8 ExtSpeed (%). Start low, raise gradually. |
| `bcap_connect_timeout` | `5.0` | Fast-fail on a bad IP (connect only). |
| `bcap_timeout` | `120` | Operation timeout — must exceed the longest PTP at low speed. |
| `bcap_provider` | `CaoProv.DENSO.VRC` | ORiN provider. VRC works for the real RC8/COBOTTA over b-CAP; RC8 → E_INVALIDARG. |
| `cobotta_prep` | `true` | Run the COBOTTA pre-clear + servo-prep sequence on connect (see §6b). |

`ExtSpeed` is sent as `[speed, accel, decel]` (all = `ext_speed`), per the official
DENSO b-CAP samples — a scalar errors `0x80070057`.

> **Verified on hardware (2026-07-01):** full chain confirmed — network → b-CAP
> (`VRC`) → servo-on (token) → real joint readback (`/api/actual-joints-real`
> `available:true`) → gripper → PTP move (arm reached target). `launch_physical.sh`
> previously **forced `bcap_provider=RC8`** (→ E_INVALIDARG at `[2/8] controller_connect`);
> it now defaults to **VRC**. Override with `BCAP_PROVIDER=… bash launch_physical.sh` if
> ever needed.

---

## 9. Canon camera (192.168.0.90)

The integrated Canon camera is a **network** device on the PoE switch (own IP
`192.168.0.90`, stored as `Robot.cameraip`). It is **not** powered by a direct
PC↔robot cable — needs the PoE switch. Touch test: it runs **warm** when on.

Two access paths:
- **Cross-platform (used for detection) ✅ VERIFIED:** Canon **WebView HTTP** — snapshot
  CGI **`http://192.168.0.90/-wvhttp-01-/image.cgi`** (Digest auth, lab creds
  `admin:password`). Feed it to `vision_node` (no COM, Win+Linux). Full recipe:
  [cobotta-camera-object-detection.md](cobotta-camera-object-detection.md).
  ```bash
  nc -vz 192.168.0.90 80        # WebView — open
  nc -vz 192.168.0.90 554       # RTSP — refused on this model
  curl --digest -u admin:password -o t.jpg "http://192.168.0.90/-wvhttp-01-/image.cgi"
  ```

  **Object detection — `vision_node` on the Canon** (feeds `/vision/object_detected`):
  ```bash
  cd /home/filippo/DTblocklyGPT
  source /opt/ros/jazzy/setup.bash && source ros2_ws/install/setup.bash
  poetry run python ros2_ws/src/cobotta_rest_api/cobotta_rest_api/vision_node.py --ros-args \
    -p camera_source:=http://192.168.0.90/-wvhttp-01-/image.cgi \
    -p camera_user:=admin -p camera_pass:=password
  curl -s http://localhost:5000/api/vision/state | python3 -m json.tool
  ```

  **YOLO one-shot** (snapshot + inference + annotated image, no ROS):
  ```bash
  poetry run python - <<'EOF'
  import cv2, numpy as np, requests
  from requests.auth import HTTPDigestAuth
  from ultralytics import YOLO
  r = requests.get("http://192.168.0.90/-wvhttp-01-/image.cgi",
                   auth=HTTPDigestAuth("admin", "password"), timeout=10)
  frame = cv2.imdecode(np.frombuffer(r.content, np.uint8), cv2.IMREAD_COLOR)
  res = YOLO("yolov8n.pt")(frame, conf=0.35, verbose=False)[0]
  print([(res.names[int(b.cls[0])], round(float(b.conf[0]), 3)) for b in res.boxes])
  cv2.imwrite("annot.jpg", res.plot())
  EOF
  ```
- **Legacy (Windows only):** ORiN Canon provider (`CaoProv.Canon.N10-W02`) via
  `acquire_photo`/`get_photo` in [robot.py](../backend/functions/robot.py) — COM /
  pywin32. Only the contour/calibration still-photo feature; does **not** feed YOLO.

The COBOTTA's vision in DENSO's own tooling is exposed via the **Cobotta World**
Android app (`com.denso_wave.cobottaworld`), separate from our pipeline.

---

## 10. Official DENSO references

- b-CAP Python samples (sequence reference): `DENSO-2DLab/orin_bcap_python_samples`
  (`SimpleSamples/04_00_Move.py` — minimal TakeArm → Motor → ExtSpeed → Move).
- Official ROS2 driver (alternative to our custom client): `DENSORobot/denso_robot_ros2`.
- Android virtual TP: `com.denso_wave.rc8.remotetp`. Programmer password `5596045`.

---

## 11. Windows + WSL2 setup (alternative to Mac + VM)

On Windows the ROS2 stack runs **inside WSL2** (same as Linux); only host→robot
reachability and where Django runs differ. This is the original architecture (old
`bat/_main.bat`: Django + npm on Windows, ROS nodes in WSL). It is **easier** than the
Mac path: the token is set with the desktop Virtual TP, and the **Canon camera works**.

**Network (WSL2 → robot).** See [cobotta-connection.md](cobotta-connection.md):
- Win11: `%USERPROFILE%\.wslconfig` → `[wsl2]` `networkingMode=mirrored` → `wsl
  --shutdown`. WSL then shares the host NICs.
- Win10: default NAT works if the Windows Ethernet NIC is on `192.168.0.x` (use
  `192.168.0.100`). Allow outbound TCP 5007 in Windows Firewall.
- Verify in WSL: `nc -vz 192.168.0.1 5007`.

**Token (desktop Virtual TP — no Android needed).** Install **ORiN2 SDK → Robot Tools**
(in this order). Launch the Virtual TP → connect `192.168.0.1` → profile **Programmer**,
password **`5596045`** → `F6 Setting → F5 Communication and Token → F1 Executable Token`
→ **Ethernet** + IP **`192.168.0.100`** (the Windows host IP the controller sees) or
**Any**; `F2 Network and Permission → Permission → Read/Write`. One-time; persists.

**Run split:**
- ROS2 + Gazebo + `cobotta_node`: in **WSL2** —
  `cd ros2_ws/Cobotta && BCAP_HOST=192.168.0.1 EXT_SPEED=20 bash launch_physical.sh`.
- Django: on the **Windows host** (`DRIVE_HARDWARE=1 poetry run python manage.py
  runserver`) **to use the Canon camera** — reaches the WSL flask bridge via
  `localhost:5000` (WSL2 localhost forwarding / mirrored). Or run Django in WSL:
  everything works **except** `get_photo`.
- Frontend `npm start`: either side.

**Camera.** With Django on the Windows host, `get_photo` drives the Canon
(`192.168.0.90`, PoE-powered) via the ORiN Canon COM provider (`pywin32`) natively — no
RTSP workaround. That is the legacy contour/calibration photo feature; the YOLO
object-detection pipeline in `vision_node` (WSL) still uses a USB/`camera_source` webcam.
