"""
Application service for the Macro Task lifecycle.
Orchestrates: dependency validation → DAG → signature → promotion draft→published.
"""
from __future__ import annotations
from typing import TypedDict

from backend.models import Task
from backend.services.dag import has_cycle
from backend.services.signature import compute_signature


class PublishResult(TypedDict):
    ok: bool
    # "published" | "cycle" | "breaking_changes" | "invalid_dependencies"
    reason: str
    stale_deps: list[int]   # Macro IDs with changed signature (only for breaking_changes)


def _get_saved_deps(macro_id: int) -> list[int]:
    """Returns the already saved dependencies for a macro (list of IDs)."""
    task = Task.objects.filter(id=macro_id).only("dependencies").first()
    if task is None:
        return []
    return task.dependencies or []


def publish_macro(
    task: Task,
    dependencies: list[int],
    force: bool = False,
) -> PublishResult:
    """
    Attempts to publish a Macro Task.

    Operation order:
    1. Dependency validation (exist, are macro_task, no self-loop)
    2. DAG check on the entire graph
    3. Signature calculation of the draft_workspace
    4. If force=False: breaking changes check (dependent macros with a different signature)
    5. Promotion draft_workspace → published_workspace
    """

    # ── 1. Dependency validation ─────────────────────────────────────────────
    if task.id in dependencies:
        return PublishResult(ok=False, reason="cycle", stale_deps=[])

    if dependencies:
        valid_deps = Task.objects.filter(
            id__in=dependencies,
            task_type="macro_task",
        ).values_list("id", flat=True)

        invalid = set(dependencies) - set(valid_deps)
        if invalid:
            return PublishResult(
                ok=False,
                reason="invalid_dependencies",
                stale_deps=list(invalid),
            )

    # ── 2. DAG check ─────────────────────────────────────────────────────────
    if has_cycle(task.id, dependencies, _get_saved_deps):
        return PublishResult(ok=False, reason="cycle", stale_deps=[])

    # ── 3. Draft workspace signature ─────────────────────────────────────────
    new_signature = compute_signature(task.draft_workspace)

    # ── 4. Breaking changes check (skip if force=True) ───────────────────────
    if not force and task.signature and task.signature != new_signature:
        # Find macros that depend on this one and still have a signature aligned
        # to the old signature (they might be impacted)
        all_macros = Task.objects.filter(
            task_type="macro_task",
        ).exclude(signature="").only("id", "dependencies")

        stale = [
            m.id
            for m in all_macros
            if isinstance(m.dependencies, list) and task.id in m.dependencies
        ]
        if stale:
            return PublishResult(
                ok=False,
                reason="breaking_changes",
                stale_deps=stale,
            )

    # ── 5. Draft → published promotion ───────────────────────────────────────
    task.published_workspace = task.draft_workspace
    task.signature = new_signature
    task.status = "published"
    task.dependencies = dependencies
    task.save(update_fields=[
        "published_workspace",
        "signature",
        "status",
        "dependencies",
    ])

    return PublishResult(ok=True, reason="published", stale_deps=[])