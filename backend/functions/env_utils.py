"""Small environment-variable helpers shared across backend modules.

Centralizes parsing so the same flag is interpreted identically everywhere
(e.g. DRIVE_HARDWARE in both calibration.py and simulate.py).
"""

import os

# Strings that count as a "true" boolean when read from the environment.
_TRUTHY = ("1", "true", "yes", "on")


def get_bool_env(key: str, default: bool = False) -> bool:
    """Return the boolean value of environment variable ``key``.

    Treats ``"1"``, ``"true"``, ``"yes"`` and ``"on"`` (case-insensitive,
    surrounding whitespace ignored) as ``True``. Any other non-empty value is
    ``False``. When the variable is unset, returns ``default``.
    """
    raw = os.getenv(key)
    if raw is None:
        return default
    return raw.strip().lower() in _TRUTHY


def get_int_env(key: str, default: int, minimum: int = 1) -> int:
    """Return the integer value of environment variable ``key``.

    Falls back to ``default`` when unset, unparseable, or below ``minimum`` —
    a timeout of 0 or a typo like "30s" must not silently produce a step that
    expires instantly, which would look like an operator failure rather than a
    misconfiguration.
    """
    raw = os.getenv(key)
    if raw is None:
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        return default
    return value if value >= minimum else default
