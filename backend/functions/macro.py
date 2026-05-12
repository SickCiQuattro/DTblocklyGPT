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
from json import loads
from backend.utils.date import getDateTimeNow


def publish_macro_task(request: HttpRequest) -> HttpResponse:
    """
    POST api/macro/publish/
    Body: { id, dependencies: int[], forcePublish?: bool }

    Responses:
      200 — successfully published
      202 — breaking changes, requires forcePublish: true
      409 — cycle detected in the DAG
      400 — invalid dependencies / task not found
    """
    try:
        if not request.user.is_authenticated:
            return unauthorized_request()
        if request.method != HttpMethod.POST.value:
            return invalid_request_method()

        data = loads(request.body)
        task_id = data.get("id")
        dependencies: list[int] = data.get("dependencies", [])
        force: bool = bool(data.get("forcePublish", False))

        task = Task.objects.filter(id=task_id, task_type="macro_task").first()
        if task is None:
            return error_response("Macro task not found")

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

        # invalid_dependencies
        return bad_request(
            "Invalid dependencies",
            {"stale_deps": result["stale_deps"]},
        )

    except Exception as e:
        return error_response(str(e))


def save_macro_draft(request: HttpRequest) -> HttpResponse:
    """
    PUT api/macro/saveDraft/
    Body: { id, taskStructure: dict }
    """
    try:
        if not request.user.is_authenticated:
            return unauthorized_request()
        if request.method != HttpMethod.PUT.value:
            return invalid_request_method()

        data = loads(request.body)
        task_id = data.get("id")
        task_structure = data.get("taskStructure")

        updated = Task.objects.filter(
            id=task_id, task_type="macro_task"
        ).update(
            draft_workspace=task_structure,
            last_modified=getDateTimeNow(),
            status=Case(
                # only if already published → published_with_draft
                When(status="published", then=Value("published_with_draft")),
                # in all other cases (draft, published_with_draft) → unchanged
                default=F("status"),
            ),
        )

        if not updated:
            return error_response("Macro task not found")

        return success_response()

    except Exception as e:
        return error_response(str(e))


def discard_macro_draft(request: HttpRequest) -> HttpResponse:
    """
    POST api/macro/discardDraft/
    Body: { id }
    Restores draft_workspace <- published_workspace.
    """
    try:
        if not request.user.is_authenticated:
            return unauthorized_request()
        if request.method != HttpMethod.POST.value:
            return invalid_request_method()

        data = loads(request.body)
        task_id = data.get("id")

        task = Task.objects.filter(id=task_id, task_type="macro_task").first()
        if task is None:
            return error_response("Macro task not found")

        task.draft_workspace = task.published_workspace
        task.status = "published" if task.published_workspace else "draft"
        task.save(update_fields=["draft_workspace", "status"])

        return success_response()

    except Exception as e:
        return error_response(str(e))
