#!/usr/bin/env python3
"""Read-only b-CAP probe for the physical COBOTTA.

Connects, reads the controller auto/manual mode and the last error, then
disconnects. Does NOT TakeArm or enable motors — safe, no motion, no fault.
Safe to run while the stack (and cobotta_node's own B-CAP session) is up: this
opens its own, independent TCP connection.

Run (from ros2_ws sourced env):
    python3 testing/bcap_probe.py 192.168.0.1 5007
"""
import sys
import os

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "ros2_ws", "src",
                 "cobotta_rest_api", "cobotta_rest_api"),
)
from orin.bcapclient import BCAPClient  # noqa: E402


def hx(v):
    try:
        return hex(int(v) & 0xFFFFFFFF)
    except Exception:
        return repr(v)


def probe(host: str, port: int, verbose: bool = True) -> bool:
    """Connect and read controller status. Returns True iff every read
    succeeded and GetCurErrorCount reports zero (no latched fault)."""
    ok = True
    c = BCAPClient(host, port, 5.0)
    if verbose:
        print(f"connected TCP {host}:{port}")
    c.service_start("")
    c.settimeout(10.0)
    hctrl = c.controller_connect("", "CaoProv.DENSO.VRC", "localhost", "")
    if verbose:
        print("controller_connect OK")

    results = {}
    for cmd in ("GetAutoMode", "GetMode", "GetCurErrorInfo", "GetCurErrorCount"):
        try:
            res = c.controller_execute(hctrl, cmd)
            results[cmd] = res
            if verbose:
                print(f"  {cmd:18s} -> {res}  ({hx(res) if isinstance(res, (int, float)) else ''})")
        except Exception as e:
            ok = False
            if verbose:
                print(f"  {cmd:18s} -> EXC {e}")

    try:
        c.controller_disconnect(hctrl)
        c.service_stop()
    except Exception:
        pass

    if results.get("GetCurErrorCount", 1) != 0:
        ok = False
    if verbose:
        print("done" if ok else "done (with errors)")
    return ok


if __name__ == "__main__":
    host = sys.argv[1] if len(sys.argv) > 1 else "192.168.0.1"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 5007
    sys.exit(0 if probe(host, port) else 1)
