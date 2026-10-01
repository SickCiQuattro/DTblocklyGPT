#!/usr/bin/env python3
"""Encoder noise of the real arm at rest — does 2 degrees separate noise from divergence?

Reads the six joint angles from the Flask bridge (/api/actual-joints-real) at a
fixed rate for a fixed time, with the arm powered, still and in a known pose,
and reports min / max / peak-to-peak / standard deviation per joint against the
threshold HW_VERIFY_TOL_DEG that _verify_hw_arrival aborts on.

Read-only: it never sends a move. Needs the stack up (launch_physical.sh) so the
bridge is answering; the Poetry env is enough, no ROS environment.

    poetry run python testing/measure_encoder_noise.py                # 60 s at 10 Hz
    poetry run python testing/measure_encoder_noise.py --seconds 30 --out misure/rumore.json

The arm must not be moving, and nobody should be touching the teach pendant's
jog keys. If a joint's peak-to-peak is a real fraction of the threshold, the
threshold has no margin on that joint; if it is tiny, it has a lot.
"""
import argparse
import json
import os
import statistics as st
import sys
import time

import requests

JOINTS = ["J1", "J2", "J3", "J4", "J5", "J6"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--url", default=os.getenv("FLASK_BRIDGE_URL", "http://localhost:5000").strip('"'))
    ap.add_argument("--seconds", type=float, default=60.0)
    ap.add_argument("--hz", type=float, default=10.0)
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    tol = 2.0
    try:  # the threshold the safety check really uses
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
        os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")
        from backend.functions.calibration import HW_VERIFY_TOL_DEG
        tol = HW_VERIFY_TOL_DEG
    except Exception:
        pass

    samples, missing = [], 0
    period = 1.0 / args.hz
    end = time.monotonic() + args.seconds
    print(f"Leggo {args.url} per {args.seconds:.0f} s a {args.hz:g} Hz. Il braccio deve stare fermo.")
    while time.monotonic() < end:
        t0 = time.monotonic()
        try:
            r = requests.get(f"{args.url}/api/actual-joints-real", timeout=2)
            d = r.json()
            pos = d.get("position", []) if d.get("available") else []
        except Exception:
            pos = []
        if len(pos) >= 6:
            samples.append([float(x) for x in pos[:6]])
        else:
            missing += 1
        time.sleep(max(0.0, period - (time.monotonic() - t0)))

    if len(samples) < 10:
        print(f"Solo {len(samples)} letture valide ({missing} mancanti): encoder non pubblicati. "
              "Il robot e' collegato e cobotta_node attivo?")
        return 1

    righe = []
    print(f"\n{len(samples)} letture, {missing} mancanti. Soglia di arresto: {tol:g} gradi.\n")
    print(f"{'giunto':6s} {'min':>9s} {'max':>9s} {'picco-picco':>12s} {'dev.std':>9s} {'% soglia':>9s}")
    for i, nome in enumerate(JOINTS):
        col = [s[i] for s in samples]
        pp = max(col) - min(col)
        sd = st.pstdev(col)
        righe.append({"joint": nome, "min": min(col), "max": max(col), "peak_to_peak": pp,
                      "stdev": sd, "unique_values": len(set(col))})
        print(f"{nome:6s} {min(col):9.3f} {max(col):9.3f} {pp:12.4f} {sd:9.4f} {100 * pp / tol:8.1f}%")
    worst = max(r["peak_to_peak"] for r in righe)
    print(f"\nPeggior picco-picco {worst:.4f} gradi = {100 * worst / tol:.1f}% della soglia. "
          + ("Il rumore a riposo sta molto sotto la soglia." if worst < 0.25 * tol
             else "ATTENZIONE: il rumore occupa una parte non piccola della soglia."))
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump({"url": args.url, "seconds": args.seconds, "hz": args.hz, "tol_deg": tol,
                       "n": len(samples), "missing": missing, "joints": righe,
                       "samples": samples}, f)
        print(f"Salvato in {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
