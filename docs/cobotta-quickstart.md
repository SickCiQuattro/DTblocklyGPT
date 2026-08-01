# COBOTTA — Quickstart

Full detail: [cobotta-physical-testing.md](cobotta-physical-testing.md).

> **Safety:** keep the e-stop in hand. `/api/stop` halts Gazebo ONLY, NOT the real arm.
> Start at `EXT_SPEED=20`. Robot LED must be **green** before connecting.

---

## 1. Mac — network (one-time)
en6 (USB-C adapter) static `192.168.0.100 / 255.255.255.0`, router blank (System Settings). Then:
```bash
sudo sysctl -w net.inet.ip.forwarding=1
echo 'nat on en6 from 192.168.64.0/24 to any -> (en6)' | sudo pfctl -ef -
nc -vz 192.168.0.1 5007        # "succeeded"
```

## 2. VM — verify + (if needed) build
```bash
nc -vz 192.168.0.1 5007
# only if you changed the nodes:
cd /home/filippo/DTblocklyGPT/ros2_ws && source /opt/ros/jazzy/setup.bash && source .venv/bin/activate \
  && colcon build --packages-select cobotta_rest_api my_robot_interfaces && source install/setup.bash
```

## 3. Terminal 1 — physical stack
```bash
cd /home/filippo/DTblocklyGPT/ros2_ws/Cobotta
BCAP_HOST=192.168.0.1 EXT_SPEED=20 bash launch_physical.sh
```
Wait for: `[8/8] ExtSpeed` → **`B-CAP connected (ExtSpeed=20)`**.

## 4. Terminal 2 / Terminal 3 — Django + frontend
```bash
# Terminal 2
cd /home/filippo/DTblocklyGPT && DRIVE_HARDWARE=1 poetry run python manage.py runserver
# Terminal 3
npm start
```

## 5. Connection test (no motion)
```bash
curl -s http://localhost:5000/api/actual-joints-real | python3 -m json.tool
# {"available": true, "position": [j1..j6]}
```
Move the arm by hand (FNC) then curl again: the values **change** confirms the closed loop.

## 6. Motion test (keep the e-stop in hand)
```bash
# gripper (minimal):
curl -s -X POST http://localhost:5000/api/move-target -H 'Content-Type: application/json' -d '{"hand_only": true, "hand": 0}'
curl -s -X POST http://localhost:5000/api/move-target -H 'Content-Type: application/json' -d '{"hand_only": true, "hand": 30}'
# small low-speed move:
curl -s -X POST http://localhost:5000/api/move-target -H 'Content-Type: application/json' \
  -d '{"j1":0,"j2":20,"j3":100,"j4":0,"j5":60,"j6":0,"hand":30}'
```
Expect `{"ok": true}` and the arm moves. Then try a **pick→place** task from the frontend (Simulate).

## 6b. Canon webcam + object detection (optional) — ✅ verified
`launch_physical.sh` **can start `vision_node` on the Canon** (env `CAMERA_SOURCE/USER/PASS`), but
`ENABLE_VISION` defaults to **false**, so it does NOT start on its own: it needs an explicit
`ENABLE_VISION=1`. The commands below are only for a **standalone** start / a different camera.
Camera: WebView HTTP, endpoint **`image.cgi`**, Digest **admin:password**.
```bash
# snapshot test:
curl --digest -u admin:password -o /tmp/t.jpg "http://192.168.0.90/-wvhttp-01-/image.cgi"
# vision_node — use the Poetry python (NOT 'ros2 run': its shebang is the system python, no ultralytics):
cd /home/filippo/DTblocklyGPT && source /opt/ros/jazzy/setup.bash && source ros2_ws/install/setup.bash
poetry run python ros2_ws/src/cobotta_rest_api/cobotta_rest_api/vision_node.py --ros-args \
  -p camera_source:=http://192.168.0.90/-wvhttp-01-/image.cgi -p camera_user:=admin -p camera_pass:=password
# check detections (put a bottle/person in view):
curl -s http://localhost:5000/api/vision/state | python3 -m json.tool
```

## 7. Stop
```bash
curl -s -X POST http://localhost:5000/api/stop     # stops Gazebo
# real arm → physical e-stop ; stack → Ctrl+C in Terminal 1
```

---

## If something goes wrong
| Symptom | Fix |
|---|---|
| `nc 5007` fails | Is en6 at `.100`? `pfctl`/forwarding set on the Mac? Robot on/green? |
| `B-CAP connection failed` | Check the `cobotta_node` log: network / e-stop. |
| `[7/8] Motor on 0x83501029` | Token NOT active, check Executable Token = Any/Ethernet+`.100`. |
| `actual-joints-real available:false` | `cobotta_node` not `_hw_ok` (connect not completed). |
| `move-target ok:false` | Check the `cobotta_node` log (the real error is logged there). |
| Robot LED yellow | Error state: press/release FNC, or run `python3 testing/bcap_probe.py 192.168.0.1 5007`. |
| `provider=CaoProv.DENSO.RC8` in the log / E_INVALIDARG at `[2/8]` | Must be **VRC**; `launch_physical.sh` now defaults to VRC (was RC8). |
| `ModuleNotFoundError: ultralytics` | `vision_node` must be launched with `poetry run python <file>`, not `ros2 run`. |
| Camera snapshot `400`/`401` | Use `image.cgi` (not GetOneShot) + `--digest -u admin:password`. |
