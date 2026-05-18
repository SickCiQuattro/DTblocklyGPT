import hashlib
import json
from typing import Any

SIGNATURE_ALGORITHM = "sha256"
SIGNATURE_HEX_LENGTH = 16


def build_task_signature(
    payload: Any,
    *,
    algorithm: str = SIGNATURE_ALGORITHM,
    hex_length: int = SIGNATURE_HEX_LENGTH,
) -> str:
    normalized_payload = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.new(algorithm, normalized_payload.encode()).hexdigest()[:hex_length]
