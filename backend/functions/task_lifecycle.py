from django.http import HttpResponse, HttpRequest
from django.db.models import Case, When, Value, F
from backend.utils.response import (
    HttpMethod,
    invalid_request_method,
    error_response,
    bad_request,
    success_response,
    unauthorized_request,
    accepted_response,
    conflict_response,
)
from backend.models import Task
from backend.services.macro_lifecycle import publish_macro
from backend.utils.date import getDateTimeNow
from json import loads


def save_draft(request: HttpRequest) -> HttpResponse:
    """
    PUT api/task/save-draft/
    Body: { id, taskStructure: dict }

    Unified save-draft for ALL tasks (regular and macro alike).

    Status transitions:
      draft                → draft                (unchanged)
      published            → published_with_draft
      published_with_draft → published_with_draft (unchanged)
    """
    try:
        if not request.user.is_authenticated:
            return unauthorized_request()
        if request.method != HttpMethod.PUT.value:
            return invalid_request_method()

        data = loads(request.body)
        task_id = data.get("id")
        task_structure = data.get("taskStructure")

        updated = Task.objects.filter(id=task_id).update(
            draft_workspace=task_structure,
            last_modified=getDateTimeNow(),
            status=Case(
                When(status="published", then=Value("published_with_draft")),
                default=F("status"),
            ),
        )

        if not updated:
            return error_response("Task not found")

        return success_response()

    except Exception as e:
        return error_response(str(e))


def publish_task(request: HttpRequest) -> HttpResponse:
    """
    POST api/task/publish/
    Body: { id, taskStructure: dict, dependencies: int[], forcePublish?: bool }

    Unified publish for ALL tasks (regular and macro alike).

    Responses:
      200 — successfully published, { signature }
      202 — breaking changes detected, { stale_deps }  (requires forcePublish: true)
      409 — dependency cycle detected, { stale_deps }
      400 — invalid dependencies / task not found
    """
    try:
        if not request.user.is_authenticated:
            return unauthorized_request()
        if request.method != HttpMethod.POST.value:
            return invalid_request_method()

        data = loads(request.body)
        task_id = data.get("id")
        task_structure = data.get("taskStructure")
        dependencies: list[int] = data.get("dependencies", [])
        force: bool = bool(data.get("forcePublish", False))

        task = Task.objects.filter(id=task_id).first()
        if task is None:
            return error_response("Task not found")

        # Sync draft_workspace before publish
        task.draft_workspace = task_structure
        task.save(update_fields=["draft_workspace"])

        result = publish_macro(task, dependencies, force=force)

        if result["ok"]:
            return success_response({"signature": task.signature})

        if result["reason"] == "cycle":
            return conflict_response(
                "Dependency cycle detected",
                {"stale_deps": result["stale_deps"]},
            )

        if result["reason"] == "breaking_changes":
            return accepted_response(
                "Breaking changes detected — confirm with forcePublish",
                {"stale_deps": result["stale_deps"]},
            )

        return bad_request(
            "Invalid dependencies",
            {"stale_deps": result["stale_deps"]},
        )

    except Exception as e:
        return error_response(str(e))


def discard_draft(request: HttpRequest) -> HttpResponse:
    """
    POST api/task/discard-draft/
    Body: { id }

    Unified discard-draft for ALL tasks.
    Restores draft_workspace <- published_workspace, status -> 'published'.
    No-op if task is still in 'draft' (never published).
    """
    try:
        if not request.user.is_authenticated:
            return unauthorized_request()
        if request.method != HttpMethod.POST.value:
            return invalid_request_method()

        data = loads(request.body)
        task_id = data.get("id")

        task = Task.objects.filter(id=task_id).first()
        if task is None:
            return error_response("Task not found")

        if task.status == "draft":
            return error_response("Task has no published version to revert to")

        task.draft_workspace = task.published_workspace
        task.status = "published"
        task.save(update_fields=["draft_workspace", "status"])

        return success_response()

    except Exception as e:
        return error_response(str(e))
