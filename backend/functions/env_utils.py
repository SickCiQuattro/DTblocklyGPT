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
