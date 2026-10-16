"""Guard: nothing must reload the page by itself during a measured session.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_no_auto_reload_in_study.py -v

Reported 2026-09-10: "every so often the system refreshes at random while I am
creating tasks — one participant was even shown a reload page."

The mechanism is Vite's client, not the app. On losing its WebSocket it does
(node_modules/vite/dist/client/client.mjs, the `custom` case):

    if (payload.event === "vite:ws:disconnect") {
      await waitForSuccessfulPing(url.href)
      location.reload()
    }

No file has to change. Any dropped socket reloads the page, and a machine
running Gazebo under thermal throttling drops one routinely.

WHAT DOES NOT FIX IT, and this file exists to stop the claim coming back:
`server.hmr: false`. It reads like the switch and it is not. Probed on
2026-09-10 by opening a `vite-hmr` WebSocket against a dev server started with
VITE_STUDY_MODE=1 and =0: the socket CONNECTS in both. Vite 8 keeps the
websocket server up regardless, so the disconnect that triggers the reload can
still happen. `hmr: false` only stops module updates.

WHAT DOES FIX IT is not a dev-server flag: serve a BUILD. `npx vite build`
output contains no Vite client at all, verified by grepping the emitted
index.html and assets for `@vite/client` and `vite:ws:disconnect` (zero hits),
and `vite preview` answers no `vite-hmr` handshake. A page with no client
cannot reload itself.

So the tests below assert two separate things: that the build stays free of the
client (the real guarantee), and that the hmr flag keeps its honest comment
rather than drifting back into a claim it cannot support.
"""
import os
import re

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CONFIG = os.path.join(ROOT, "vite.config.mts")


def _code() -> str:
    src = open(CONFIG, encoding="utf-8").read()
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    return "\n".join(
        line for line in src.split("\n")
        if line.strip() and not line.strip().startswith("//")
    )


def test_hmr_is_disabled_under_study_mode():
    """Still worth doing: it stops a stray save swapping code mid-task.

    It is NOT the reload fix, and the next test guards that distinction.
    """
    code = _code()
    assert "hmr:" in code, "vite.config non configura piu' hmr"
    hmr_line = next(line for line in code.split("\n") if "hmr:" in line)
    assert "studyMode" in hmr_line and "false" in hmr_line, (
        f"la riga hmr non e' piu' legata allo study mode: {hmr_line.strip()!r}"
    )


def test_the_config_does_not_claim_hmr_false_stops_the_reload():
    """The claim this file was written on was wrong, and cost a false fix.

    Measured: with `hmr: false` the `vite-hmr` WebSocket still connects, so the
    disconnect that triggers `location.reload()` can still happen. If the
    comment drifts back into promising a fix, the next person stops looking for
    the real one.
    """
    src = open(CONFIG, encoding="utf-8").read()
    hmr_comment = src[src.index("// Disables HMR module updates"):src.index("hmr: studyMode")]
    assert "does NOT do" in hmr_comment, (
        "il commento su hmr non dice piu' che NON ferma il reload della "
        "pagina: e' l'affermazione sbagliata che ha prodotto un fix finto."
    )
    assert "build" in hmr_comment, (
        "il commento non indirizza piu' alla soluzione vera (servire un build)."
    )


def test_a_build_contains_no_vite_client():
    """The actual guarantee: a page with no client cannot reload itself.

    Skipped when no build exists, because building here would be slow and this
    is a property of the artefact, not of the source.
    """
    dist = os.path.join(ROOT, "frontend", "dist")
    index = os.path.join(dist, "index.html")
    if not os.path.exists(index):
        pytest.skip("nessun build in frontend/dist")
    blobs = [open(index, encoding="utf-8").read()]
    assets = os.path.join(dist, "assets")
    if os.path.isdir(assets):
        for name in os.listdir(assets):
            if name.endswith(".js"):
                blobs.append(open(os.path.join(assets, name), encoding="utf-8",
                                  errors="replace").read())
    joined = "\n".join(blobs)
    for needle in ("@vite/client", "vite:ws:disconnect"):
        assert needle not in joined, (
            f"il build contiene {needle!r}: la pagina servita puo' ricaricarsi "
            "da sola, che e' esattamente cio' che servire un build dovrebbe "
            "rendere impossibile."
        )


def test_study_mode_is_read_from_the_same_place_as_the_app():
    """One setting, not two.

    The app reads VITE_STUDY_MODE from frontend/.env via import.meta.env. If
    the config read a different variable, a session could have the study UI
    with HMR still live, or the reverse — and the failure would only show up
    as a reload mid-session.
    """
    code = _code()
    assert "loadEnv(" in code, (
        "il config non carica piu' frontend/.env: legge process.env, che non "
        "vede il file che configura l'app."
    )
    assert "VITE_STUDY_MODE" in code, (
        "il config non usa piu' la stessa variabile dell'app."
    )


def test_the_reload_on_disconnect_still_exists_upstream():
    """The canary: if Vite ever stops doing this, the flag can go.

    Reading the installed client rather than trusting the note above, so an
    upgrade that removes the behaviour shows up here instead of leaving a
    workaround nobody dares delete.
    """
    client = os.path.join(ROOT, "node_modules", "vite", "dist", "client", "client.mjs")
    if not os.path.exists(client):
        pytest.skip("vite non installato in questo ambiente")
    src = open(client, encoding="utf-8").read()
    assert "vite:ws:disconnect" in src and "location.reload()" in src, (
        "il client di Vite non ricarica piu' la pagina alla disconnessione: "
        "verificare se `hmr: false` in study mode serve ancora."
    )


def test_preview_carries_the_camera_proxy_and_the_port():
    """Serving a build is the whole point of this file, and `vite preview` reads
    `preview:` — not `server:`. The robot panel asks for /camera/stream
    same-origin, so without a proxy here the camera frame is dead for the whole
    session and nothing in the app says why. The docs told operators to run
    `vite preview` from 2026-09-18, before this block existed.
    """
    code = _code()
    preview = re.search(r"preview:\s*\{(.*?)\n    \},", code, re.DOTALL)
    assert preview, "no `preview:` block — `vite preview` gets no proxy and no port"
    body = preview.group(1)
    assert "proxy" in body, "preview has no proxy: /camera/stream will 404"
    assert "port: 3000" in body, (
        "preview has no port: the app would come up somewhere other than :3000, "
        "which is what CSRF_TRUSTED_ORIGINS and the checklist both name"
    )
    assert "cameraProxy" in body and "proxy: cameraProxy" in code, (
        "server and preview must share one proxy definition, or they drift"
    )


def test_the_camera_proxy_points_at_web_video_server():
    code = _code()
    proxy = re.search(r"cameraProxy\s*=\s*\{(.*?)\n  \}", code, re.DOTALL)
    assert proxy, "cameraProxy not found"
    assert "'/camera'" in proxy.group(1)
    assert "localhost:8080" in proxy.group(1), (
        "web_video_server streams on :8080 (launch_sim.sh)"
    )
