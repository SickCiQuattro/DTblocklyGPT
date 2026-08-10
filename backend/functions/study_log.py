"""Append-only event log for user-study sessions.

Disabled unless ``STUDY_LOG_PATH`` is set, so normal operation is unaffected
and no file is created by accident.

Why this exists: the system produces no execution telemetry of any kind, so
the four Part-B measures (confirmed on first attempt, number of attempts, time
to resolution, timeout) would otherwise have to be stopwatched by hand while
the experimenter is also running the think-aloud. On durations of a few
seconds that margin of error is the same size as the effect being measured.

Why the hooks live in Django and not in the Flask bridge: the bridge only sees
outcomes, while *failed* attempts — a spoken word that isn't the expected one,
a button press outside the wait window — are visible only here. Counting
attempts is the whole point. The frontend is the wrong place for the opposite
reason: its SocketIO transport delivers bursts that React collapses into a
single render, so intermediate events are lost by construction (the same
reason `blockStepsCompleted` exists in `useRosEvents.ts`).

Each line is one JSON object. Consumers should tolerate unknown keys and
ignore malformed lines: a session is worth more than a strict schema.
"""

import json
import os
import threading
import time
from datetime import datetime, timezone

# Set to a writable path to enable logging, e.g.
#   STUDY_LOG_PATH=studio-utenti/dati/P07.jsonl
_LOG_PATH = os.getenv("STUDY_LOG_PATH")

# Free-form participant tag copied onto every event so a file can be re-checked
# against its label, and so concatenated files stay attributable.
_PARTICIPANT = os.getenv("STUDY_PARTICIPANT_ID", "")

# Writes come from the simulation thread and from Django request threads
# (voice/confirm arrive as separate HTTP requests), so appends must not
# interleave mid-line.
_lock = threading.Lock()


def is_enabled() -> bool:
    """True when a log path is configured."""
    return bool(_LOG_PATH)


def log_event(kind: str, **fields) -> None:
    """Append one event. Never raises — a logging failure must not abort a run.

    ``t_mono`` is the monotonic clock, which is what durations should be
    computed from: the wall clock can jump backwards mid-session (NTP) and
    would produce negative confirmation times.
    """
    if not _LOG_PATH:
        return
    record = {
        "kind": kind,
        "participant": _PARTICIPANT,
        "t_mono": round(time.monotonic(), 4),
        "t_wall": datetime.now(timezone.utc).isoformat(),
        **fields,
    }
    try:
        line = json.dumps(record, ensure_ascii=False, default=str)
        with _lock:
            with open(_LOG_PATH, "a", encoding="utf-8") as handle:
                handle.write(line + "\n")
    except Exception:
        # Deliberately silent: a full disk or a bad path must not take down a
        # session that is otherwise running correctly. `is_enabled()` plus the
        # pre-session checklist is how a missing log gets noticed, not an
        # exception in the middle of a participant's task.
        pass
