# Cobotta Physical Robot Connection Guide

How to connect the physical Denso Cobotta arm to the DTblocklyGPT stack, from both
Mac + Linux VM and Windows + WSL2.

---

## Architecture

All four stack processes run **inside Linux** (WSL or VM). The physical robot is
reached over TCP — the B-CAP/ORiN protocol (`cobotta_node`) is pure-Python sockets
and works identically on both platforms. The only per-platform difference is
**how the Linux environment reaches the robot's LAN subnet**.

```
Host machine (Mac / Windows)
  └─ Linux env (VM / WSL)
       ├─ Django  + simulate.py  ──DRIVE_HARDWARE=1──► POST /api/move-target
       ├─ flask_node (BridgeNodeROS) ──────────────────► /cobotta/target topic
       ├─ cobotta_node (enable_hardware=true) ──TCP──► RC8 192.168.0.1:5007
       ├─ flask_node ──JointTrajectory──► arm_controller (ros2_control) ──► Gazebo (parallel twin)
       └─ vision_node ──► /vision/object_detected ──► flask_node (detections)
```

---

## Robot-side prerequisites

1. RC8 controller powered on, no e-stop active.
2. B-CAP/ORiN provider enabled in the RC8 settings (default TCP port 5007).
3. Robot fixed with **green LED** (Normal Mode). Motor-on additionally requires this
   client to hold the **Executable Token** and the COBOTTA servo-prep sequence —
   `cobotta_node` runs the prep, but the token must be set once on the controller. See
   [cobotta-physical-testing.md](cobotta-physical-testing.md) §6b.
4. Robot IP: `192.168.0.1` (default). Change via the RC8 teach-pendant if needed.

---

## Platform networking

### Mac + Linux VM (primary)

The VM must get an IP **on the same LAN as the robot** so it can reach `192.168.0.1`.

**VMware Fusion / VirtualBox / UTM:**
- Open VM network settings.
- Change the adapter from *NAT* to **Bridged** (VMware: "Bridged Networking → Autodetect"
  or select the specific Wi-Fi/Ethernet adapter the Mac uses for the robot subnet).
- The VM will get an IP from the same DHCP/subnet as the robot (e.g. `192.168.0.x`).

Verify from inside the VM:
```bash
nc -vz 192.168.0.1 5007      # "succeeded" = reachable
```
Or use the app's built-in ping endpoint (Manager panel → robot detail → Ping).

**NAT will not work** for reaching a robot on a dedicated Ethernet/subnet; use bridged.

#### USB-C Ethernet adapter (laptop without RJ-45)

If your Mac has only USB-C ports, plug a USB-C→RJ-45 adapter into the robot LAN port.
Then in the VM network settings select **that specific adapter** as the bridged interface
(not "Autodetect", not Wi-Fi). The adapter typically shows up as "USB 10/100/1000 LAN"
or similar.

The robot LAN is usually not connected to a DHCP server, so assign a **static IP** on
the Mac side:

```
System Settings → Network → USB 10/100/1000 LAN → Details → TCP/IP
  Configure IPv4: Manually
  IP address:     192.168.0.10    (or any .x in the 192.168.0/24 range)
  Subnet mask:    255.255.255.0
  Router:         (leave blank)
```

Verify from Mac before starting the VM:
```bash
ping -c 3 192.168.0.1
```

Then bridge the VM to that adapter and verify from inside the VM:
```bash
nc -vz 192.168.0.1 5007
```

---

### Windows 11 + WSL2 (mirrored networking — recommended)

Add to `%USERPROFILE%\.wslconfig`:
```ini
[wsl2]
networkingMode=mirrored
```
Restart WSL (`wsl --shutdown`, then reopen terminal). WSL now shares all host NICs,
so if Windows can reach `192.168.0.1:5007`, WSL can too with zero extra config.

Verify from inside WSL:
```bash
nc -vz 192.168.0.1 5007
```

---

### Windows 10 + WSL2 (NAT mode)

WSL2 uses NAT by default. Outbound TCP connections from WSL to the robot work as long as
the **Windows host is on the robot's subnet** (e.g. Ethernet NIC at `192.168.0.x`):

1. Ensure the Windows host Ethernet adapter has an IP in `192.168.0.x/24`.
2. Windows Firewall: allow outbound TCP to port 5007 (or disable firewall temporarily
   for the robot subnet during testing).
3. No `portproxy` needed — B-CAP is outbound from WSL (WSL initiates the connection).

Verify from PowerShell on the Windows host first:
```powershell
Test-NetConnection -ComputerName 192.168.0.1 -Port 5007
```
Then from inside WSL:
```bash
nc -vz 192.168.0.1 5007
```

---

## Running the physical twin

### 1. Set the robot IP

Two places:
- **Django DB** (`Robot.ip` field in the admin panel or seed data) — used by
  `robot.py` for position reads and `ping_ip`.
- **`BCAP_HOST` env variable** (or `bcap_host` ROS param) — used by `cobotta_node`.

### 2. Start the twin + hardware stack

```bash
# In ros2_ws/Cobotta:
BCAP_HOST=192.168.0.1 bash launch_physical.sh

# Optional: lower/raise speed (default 20 for bring-up; max 100)
EXT_SPEED=30 BCAP_HOST=192.168.0.1 bash launch_physical.sh
```

The script:
- Checks `nc` reachability before starting Gazebo (fails fast if robot unreachable).
- Starts the full Gazebo/ROS2 sim stack (parallel twin, unchanged).
- Starts `cobotta_node` with `enable_hardware:=true`.

### 3. Start Django with hardware enabled

```bash
DRIVE_HARDWARE=1 poetry run python manage.py runserver
```

`DRIVE_HARDWARE=1` causes `simulate.py` to POST each key pose to `/api/move-target`
in addition to the Gazebo waypoint stream. Without it, the sim stack is untouched.

### 4. Start the frontend

```bash
npm start
```

### 5. (Optional) Start the wrist-cam vision node

```bash
# Find the wrist-cam device index first:
ls /dev/video*
# or v4l2-ctl --list-devices

poetry run ros2 run cobotta_rest_api vision_node \
    --ros-args -p camera_source:=<device-index>
```

---

## Motion model (v1)

`cobotta_node` receives one **absolute PTP target** per `smooth_move` or
`send_waypoints` call (the endpoint of each interpolated Gazebo trajectory). The RC8
plans its own motion between poses — smooth and safe at low `ExtSpeed`, but **not
synchronized frame-by-frame with Gazebo**. The twin is visually faithful at task level
(move_to, pick, place, scan), not at the 50 Hz interpolation level.

Future work: slave-mode 50 Hz streaming via `slvMove` for exact synchronization.

---

## Safety

- `enable_hardware` defaults to **false** — the sim stack is unchanged without it.
- `ExtSpeed` defaults to **20** for initial bring-up. Raise gradually after verifying
  all poses.
- Joint values are clamped to URDF limits at `/api/move-target` before reaching the arm.
- **The `/stop` endpoint halts the Gazebo waypoint stream only.** Use the teach-pendant
  deadman switch or e-stop to halt the real arm immediately.
- Graceful failure: if B-CAP connection fails at startup, `cobotta_node` logs FATAL and
  stays alive as a no-op — Gazebo and the rest of the stack continue normally.

---

## CAO/win32com path (Windows-host only)

`backend/functions/robot.py` and `task.py` contain a `win32com`-based CAO path, guarded
by `if sys.platform == 'win32'`. It is inert on Linux/Mac VM and inside WSL (there
`Dispatch is None`, so `get_photo` returns a clear "requires Windows" error).

It is **not** dead code on Windows: when **Django runs on the Windows host** (as in the
original `bat/_main.bat` layout — Django + npm on Windows, ROS nodes in WSL), this is the
**supported way to use the Canon camera** (`get_photo`/`acquire_photo` via the ORiN Canon
COM provider at `192.168.0.90`). Robot *motion* always goes through the pure-Python b-CAP
path (`cobotta_node` in WSL), not this COM path. The wrist-cam YOLO pipeline
(`vision_node`) is independent and uses a USB webcam. See
[cobotta-physical-testing.md](cobotta-physical-testing.md) §11 (Windows + WSL2) and §9
(camera).
