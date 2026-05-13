from django.http import HttpResponse, HttpRequest
from django.db.models import Case, When, Value, F
from backend.utils.response import (
    HttpMethod,
    invalid_request_method,
    error_response,
    success_response,
    unauthorized_request,
)
from backend.models import (
    Task,
    TASK_TYPE_MACRO,
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    STATUS_PUBLISHED_WITH_DRAFT,
)
from backend.utils.date import getDateTimeNow
from json import loads


def save_draft(request: HttpRequest) -> HttpResponse:
    """
    PUT api/task/save-draft/
    Body: { id, taskStructure: dict }

    Saves the current editor state as a draft without affecting the
    published version.

    Status transitions:
      draft                -> draft                (unchanged)
      published            -> published_with_draft (macro: published_workspace intact)
      published_with_draft -> published_with_draft (unchanged)

    Workspace write path:
      macro_task  -> draft_workspace
      task        -> workspace
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

        if task.task_type == TASK_TYPE_MACRO:
            task.draft_workspace = task_structure
            task.status = new_status
            task.last_modified = getDateTimeNow()
            task.save(update_fields=["draft_workspace", "status", "last_modified"])
        else:
            task.workspace = task_structure
            task.status = new_status
            task.last_modified = getDateTimeNow()
            task.save(update_fields=["workspace", "status", "last_modified"])

        return success_response()

    except Exception as e:
        return error_response(str(e))


def publish_task(request: HttpRequest) -> HttpResponse:
    """
    POST api/task/publish/
    Body: { id, taskStructure: dict }

    Publishes the current workspace state.

    Workspace write path:
      macro_task  -> published_workspace = taskStructure
                     draft_workspace     = None
                     status              = 'published'
      task        -> workspace           = taskStructure
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

        if task.task_type == TASK_TYPE_MACRO:
            task.published_workspace = task_structure
            task.draft_workspace = None
            task.status = STATUS_PUBLISHED
            task.last_modified = getDateTimeNow()
            task.save(update_fields=[
                "published_workspace", "draft_workspace", "status", "last_modified"
            ])
        else:
            task.workspace = task_structure
            task.status = STATUS_PUBLISHED
            task.last_modified = getDateTimeNow()
            task.save(update_fields=["workspace", "status", "last_modified"])

        return success_response()

    except Exception as e:
        return error_response(str(e))


def discard_draft(request: HttpRequest) -> HttpResponse:
    """
    POST api/task/discard-draft/
    Body: { id }

    Discards the current draft and reverts to the last published version.
    No-op if task is still in 'draft' (no published version exists).

    macro_task: draft_workspace = None, status = 'published'
    task:       status = 'published' (workspace is the single source of truth,
                the published content is already there)
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

        if task.task_type == TASK_TYPE_MACRO:
            if task.published_workspace is None:
                return error_response(
                    "published_workspace is missing — cannot discard draft"
                )
            task.draft_workspace = None
            task.status = STATUS_PUBLISHED
            task.save(update_fields=["draft_workspace", "status"])
        else:
            # Regular task: workspace already holds the published content.
            # Only reset the status back to published.
            task.status = STATUS_PUBLISHED
            task.save(update_fields=["status"])

        return success_response()

    except Exception as e:
        return error_response(str(e))
