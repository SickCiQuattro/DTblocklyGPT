"""Thin HTTP client for the Flask-ROS bridge.

Centralizes the bridge base URL, per-endpoint timeouts, and a bounded retry for
the critical move-path dispatch. Behavior matches the inline ``requests`` calls
previously scattered in simulate.py — the methods raise on failure exactly as
``response.raise_for_status()`` did, so existing call-site ``try/except`` blocks
keep working. The only added behavior is a single retry on ``move_path``.

A shared ``requests.Session`` gives connection pooling across calls.
"""

import os
import time

import requests

DEFAULT_BASE_URL = os.getenv("FLASK_BRIDGE_URL", "http://localhost:5000").rstrip("/")

# Per-endpoint (connect, read) timeouts in seconds — preserved from the original
# inline call sites so timing characteristics do not change.
_STATE_TIMEOUT = (0.5, 3.0)
_MOVE_JOINTS_TIMEOUT = (0.3, 1.2)
_MOVE_PATH_TIMEOUT = (0.5, 5.0)
_MOVE_TARGET_TIMEOUT = (0.3, 60.0)
_VISION_TIMEOUT = (0.3, 1.5)
_NOTIFY_TIMEOUT = 5
# /api/stop may wait on the hardware halt channel (reconnect + retry inside
# cobotta_node): give it more room than a plain notify.
_STOP_TIMEOUT = 10

_MOVE_PATH_RETRY_DELAY_S = 0.2


class FlaskRosClient:
    """HTTP wrapper over the Flask bridge endpoints used by the simulator."""

    def __init__(self, base_url: str = DEFAULT_BASE_URL, session: requests.Session = None):
        self.base_url = base_url.rstrip("/")
        self._session = session or requests.Session()

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    # ── state ────────────────────────────────────────────────────────────────

    def get_actual_joints(self) -> list:
        """Return the joint ``position`` list from /api/actual-joints-pos."""
        resp = self._session.get(self._url("/api/actual-joints-pos"), timeout=_STATE_TIMEOUT)
        resp.raise_for_status()
        return resp.json().get("position", [])

    def get_actual_joints_real(self) -> list:
        """Return the physical arm's j1..j6 (deg) from /api/actual-joints-real, or [].

        Empty when cobotta_node is not publishing encoders (no hardware connected).
        """
        resp = self._session.get(self._url("/api/actual-joints-real"), timeout=_STATE_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        return data.get("position", []) if data.get("available") else []

    def get_vision_state(self) -> dict:
        """Return the latest gesture/detection cache from /api/vision/state."""
        resp = self._session.get(self._url("/api/vision/state"), timeout=_VISION_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    # ── motion ───────────────────────────────────────────────────────────────

    def move_joints(self, params: dict) -> None:
        """GET /api/move-joints with the given query params (single key pose)."""
        resp = self._session.get(self._url("/api/move-joints"), params=params, timeout=_MOVE_JOINTS_TIMEOUT)
        resp.raise_for_status()

    def move_target(self, payload: dict) -> dict:
        """POST /api/move-target — forward one key pose to the real arm.

        Raises on transport/HTTP failure (unreachable node, 5xx). Returns the
        service result {"ok": bool, "message": str} so the caller can tell a
        rejected/failed move from one that actually reached the target.
        """
        resp = self._session.post(
            self._url("/api/move-target"), json=payload, timeout=_MOVE_TARGET_TIMEOUT
        )
        resp.raise_for_status()
        return resp.json()

    def move_path(self, waypoints: list, retries: int = 1) -> None:
        """POST /api/move-path with one bounded retry — only on a connection
        failure (request never reached the server). A read timeout means the
        server may already have accepted and started the trajectory; retrying
        that would replay a real robot motion, so it is not retried."""
        last_exc = None
        for attempt in range(retries + 1):
            try:
                resp = self._session.post(
                    self._url("/api/move-path"),
                    json={"waypoints": waypoints},
                    timeout=_MOVE_PATH_TIMEOUT,
                )
                resp.raise_for_status()
                return
            except requests.exceptions.ConnectionError as exc:
                last_exc = exc
                if attempt < retries:
                    time.sleep(_MOVE_PATH_RETRY_DELAY_S)
        raise last_exc

    def stop(self) -> dict:
        """POST /api/stop — cancel any in-flight path and halt the real arm.

        Returns the bridge's body, which carries `hardware_halt`:
        ``None`` when no hardware node is running (a sim-only stop is the whole
        story there), otherwise ``{"ok": bool, "message": str}``.

        This used to return None and discard the body. The halt result was
        therefore thrown away at the one layer that could act on it, and a
        refused halt was indistinguishable from a successful one all the way up
        to the operator's screen — which is the only place it matters, because
        the answer is "use the teach-pendant e-stop now".
        """
        resp = self._session.post(self._url("/api/stop"), timeout=_STOP_TIMEOUT)
        resp.raise_for_status()
        try:
            return resp.json()
        except ValueError:
            # A 2xx with an unparseable body: the request was handled, but we
            # cannot claim anything about the arm.
            return {}

    def get_health(self) -> dict:
        """GET /api/health — aggregate status of bridge/gazebo/hardware/vision."""
        resp = self._session.get(self._url("/api/health"), timeout=_STATE_TIMEOUT)
        resp.raise_for_status()
        return resp.json()

    # ── human-step / notification channel (best-effort) ──────────────────────

    def notify(self, path: str, payload: dict = None) -> None:
        """POST a step-status/notification payload to ``path`` (e.g. /api/notify)."""
        resp = self._session.post(self._url(path), json=payload, timeout=_NOTIFY_TIMEOUT)
        resp.raise_for_status()
