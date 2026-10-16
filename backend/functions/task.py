from json import loads

from backend.models import Task


def _resolve_runtime_workspace(task: Task) -> dict | None:
    """
    Runtime read path (published-only):
    1. Normal task  → uses published_workspace, fallback to workspace, fallback to loads(code)
    2. Macro task   → uses ONLY published_workspace (never draft)

    Returns None if no workspace is available.
    """
    if task.task_type == "macro_task":
        return task.published_workspace

    # normal Task — read chain with fallback legacy
    if task.published_workspace is not None:
        return task.published_workspace
    if task.workspace is not None:
        return task.workspace
    if task.code:
        try:
            return loads(task.code)
        except (ValueError, TypeError):
            return None
    return None
