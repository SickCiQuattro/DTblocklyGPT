from django.http import HttpResponse, HttpRequest
from backend.utils.response import (
    HttpMethod,
    invalid_request_method,
    error_response,
    success_response,
    unauthorized_request,
)
from backend.models import (
    Task,
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    STATUS_PUBLISHED_WITH_DRAFT,
)
from backend.utils.date import getDateTimeNow
from backend.utils.signature import build_task_signature
from json import loads


def save_draft(request: HttpRequest) -> HttpResponse:
    """
    PUT api/task/save-draft/
    Body: { id, taskStructure: dict }

    Saves the current editor state as a draft without affecting the
    published version.  Unified for ALL task types (task_type is ignored).

    Status transitions:
      draft                -> draft                (unchanged)
      published            -> published_with_draft (published_workspace intact)
      published_with_draft -> published_with_draft (unchanged)

    Write path (all task types):
      draft_workspace = taskStructure
    """
    try:
        if not request.user.is_authenticated:
            return unauthorized_request()
        if request.method != HttpMethod.PUT.value:
            return invalid_request_method()

        data = loads(request.body)
        task_id = data.get("id")
        task_structure = data.get("taskStructure")

        task = Task.objects.filter(id=task_id).first()
        if task is None:
            return error_response("Task not found")

        new_status = (
            STATUS_PUBLISHED_WITH_DRAFT
            if task.status == STATUS_PUBLISHED
            else task.status
        )

        task.draft_workspace = task_structure
        task.status = new_status
        task.last_modified = getDateTimeNow()
        task.save(update_fields=["draft_workspace", "status", "last_modified"])

        return success_response()

    except Exception as e:
        return error_response(str(e))


def publish_task(request: HttpRequest) -> HttpResponse:
    """
    POST api/task/publish/
    Body: { id, taskStructure: dict }

    Publishes the current workspace state.
    Unified for ALL task types (task_type is ignored).

    Write path (all task types):
      published_workspace = taskStructure
      draft_workspace     = None
      status              = 'published'

    Returns 200 on success.
    """
    try:
        if not request.user.is_authenticated:
            return unauthorized_request()
        if request.method != HttpMethod.POST.value:
            return invalid_request_method()

        data = loads(request.body)
        task_id = data.get("id")
        task_structure = data.get("taskStructure")

        task = Task.objects.filter(id=task_id).first()
        if task is None:
            return error_response("Task not found")

        task.published_workspace = task_structure
        task.draft_workspace = None
        task.status = STATUS_PUBLISHED
        task.last_modified = getDateTimeNow()

        task.signature = build_task_signature(task_structure)

        task.save(update_fields=[
            "published_workspace", "draft_workspace", "status", "last_modified", "signature"
        ])

        return success_response()

    except Exception as e:
        return error_response(str(e))


def discard_draft(request: HttpRequest) -> HttpResponse:
    """
    POST api/task/discard-draft/
    Body: { id }

    Discards the current draft and reverts to the last published version.
    No-op if task is still in 'draft' (no published version exists).
    Unified for ALL task types (task_type is ignored).

    Write path (all task types):
      draft_workspace = None
      status          = 'published'
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

        if task.status == STATUS_DRAFT:
            return error_response("Task has no published version to revert to")

        if task.published_workspace is None:
            return error_response(
                "published_workspace is missing — cannot discard draft"
            )

        task.draft_workspace = None
        task.status = STATUS_PUBLISHED
        task.last_modified = getDateTimeNow()
        task.save(update_fields=["draft_workspace", "status", "last_modified"])

        return success_response()

    except Exception as e:
        return error_response(str(e))
