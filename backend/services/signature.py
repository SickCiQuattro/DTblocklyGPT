"""
Signature helper — deterministic hash of the published workspace.
Used to detect breaking changes in dependencies.
"""
from __future__ import annotations
import hashlib
import json


def compute_signature(workspace: dict | None) -> str:
    """
    Returns the SHA-256 hex (64 chars) of the serialized workspace
    in a deterministic way (sorted keys).
    Returns an empty string if workspace is None.
    """
    if workspace is None:
        return ""
    serialized = json.dumps(workspace, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()