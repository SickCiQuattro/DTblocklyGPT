from django.http import HttpResponse, HttpRequest
from backend.utils.response import (
    HttpMethod,
    invalid_request_method,
    error_response,
    success_response,
    unauthorized_request,
)
from backend.functions.chat import search_existing_libraries
from backend.models import Task, Object, Action, Location
from django.db.models import Q
from json import loads, dumps
from django.contrib.auth.models import User
from copy import deepcopy


def save_graphic_task(request: HttpRequest) -> HttpResponse:
    """
    Saves the editor workspace for a regular task.

    Body: { id, taskStructure: dict | null, publish?: bool }

    Behavior:
    - publish=True  -> workspace = taskStructure, status = 'published'
    - publish=False (default):
        - status == 'draft'     -> stays 'draft'
        - status == 'published' -> status unchanged (no regression)

    Never writes task_type (immutable after creation).
    Never writes published_workspace / draft_workspace (managed by task_lifecycle).
    """
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.PUT.value:
                data = loads(request.body)
                task_id = data.get("id")
                taskStructure = data.get("taskStructure")
                publish = data.get("publish", False)

                task = Task.objects.filter(id=task_id).first()
                if task is None:
                    return error_response("Task not found")

                workspace_value = taskStructure  # None or dict

                from backend.utils.date import getDateTimeNow

                if publish:
                    import hashlib
                    import json
                    
                    sig_input = json.dumps(workspace_value, sort_keys=True, separators=(',', ':'))
                    sig = hashlib.sha256(sig_input.encode()).hexdigest()[:16]
                    
                    Task.objects.filter(id=task_id).update(
                        published_workspace=workspace_value,
                        draft_workspace=None,
                        status="published",
                        signature=sig,
                        last_modified=getDateTimeNow()
                    )
                else:
                    new_status = (
                        "published_with_draft"
                        if task.status == "published"
                        else task.status
                    )
                    Task.objects.filter(id=task_id).update(
                        draft_workspace=workspace_value,
                        status=new_status,
                        last_modified=getDateTimeNow()
                    )

                return success_response()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def get_graphic_task(request: HttpRequest) -> HttpResponse:
    """
    Returns the editor workspace for a task.

    Unified read path (task_type is ignored):
      1. draft_workspace       — in-progress draft (status == published_with_draft)
      2. published_workspace   — last published snapshot
      3. workspace             — legacy write target (pre-lifecycle migration)
      4. loads(code)           — legacy JSON string (very old records)

    Response includes task_type and status so the frontend can render
    the correct toolbar (publish / save-draft / discard).
    """
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                task_id = request.GET.get("id")
                task = Task.objects.filter(id=task_id).first()
                if task is None:
                    return success_response()

                # ── Unified read path ──────────────────────────────────────
                if task.draft_workspace is not None:
                    raw_workspace = task.draft_workspace
                elif task.published_workspace is not None:
                    raw_workspace = task.published_workspace
                elif task.workspace is not None:
                    raw_workspace = task.workspace
                elif task.code:
                    try:
                        raw_workspace = loads(task.code)
                    except Exception:
                        raw_workspace = None
                else:
                    raw_workspace = None

                if raw_workspace is None:
                    return success_response({
                        "name": task.name,
                        "code": None,
                        "task_type": task.task_type,
                        "status": task.status,
                    })

                # ── Entity reconciliation (unchanged) ──────────────────────
                _, updated = find_and_modify(
                    raw_workspace, "OBJECT", search_library_data, request.user.id
                )
                _, updated = find_and_modify(
                    updated, "LOCATION", search_library_data, request.user.id
                )
                _, updated = find_and_modify(
                    updated, "ACTION", search_library_data, request.user.id
                )

                return success_response({
                    "name": task.name,
                    "code": updated,
                    "task_type": task.task_type,
                    "status": task.status,
                })

            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def find_and_modify(json_data, key_to_find, modification_function, user, branches=None):
    if branches is None:
        branches = []

    json_copy = deepcopy(json_data)

    def recursive_modify(data):
        if isinstance(data, dict):
            if key_to_find in data:
                branches.append(data)
                modification_function(data, user, key_to_find)

            for key, value in data.items():
                recursive_modify(value)

        elif isinstance(data, list):
            for item in data:
                recursive_modify(item)

    recursive_modify(json_copy)
    return branches, json_copy


def search_library_data(branch, user, key_to_find):
    if not branch[key_to_find] or "block" not in branch[key_to_find]:
        return
    library_type = None
    if key_to_find == "OBJECT":
        library_type = Object
    elif key_to_find == "ACTION":
        library_type = Action
    elif key_to_find == "LOCATION":
        library_type = Location

    library_data = loads(branch[key_to_find]["block"]["data"])
    if library_data["id"] is None:
        (
            library_id,
            library_name,
            library_keywords,
        ) = search_existing_libraries(
            user,
            library_type,
            branch[key_to_find]["block"]["fields"]["name"],
        )

        if library_id:
            library_data["id"] = library_id
            library_data["name"] = library_name
            library_data["keywords"] = library_keywords
            branch[key_to_find]["block"]["data"] = dumps(library_data)
            branch[key_to_find]["block"]["fields"]["name"] = library_name
    else:
        item = library_type.objects.filter(id=library_data["id"]).first()
        if item:
            library_data["id"] = item.id
            library_data["name"] = item.name
            library_data["keywords"] = ",".join(item.keywords)
            branch[key_to_find]["block"]["data"] = dumps(library_data)
            branch[key_to_find]["block"]["fields"]["name"] = item.name


def get_object_graphic_list(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                user = User.objects.get(id=request.user.id)
                objects = Object.objects.filter(Q(owner=user) | Q(shared=True)).values(
                    "id", "name", "keywords"
                )
                return success_response(objects)
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def get_action_graphic_list(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                user = User.objects.get(id=request.user.id)
                actions = Action.objects.filter(Q(owner=user) | Q(shared=True)).values(
                    "id", "name", "keywords"
                )
                return success_response(actions)
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def get_location_graphic_list(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                user = User.objects.get(id=request.user.id)
                locations = Location.objects.filter(
                    Q(owner=user) | Q(shared=True)
                ).values("id", "name", "keywords")
                return success_response(locations)
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def get_macro_list(request: HttpRequest) -> HttpResponse:
    """
    GET api/graphic/macroList/

    Returns all published tasks visible to the current user that can be used
    as macro blocks in the toolbox (task_type is intentionally NOT filtered —
    all published tasks are eligible as macro blocks).
    Excludes tasks in 'draft' status (not yet usable in the toolbox).
    Includes published_workspace so the frontend can perform block
    explosion (break-into-steps) and tooltip preview without a second fetch.
    """
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                macros = Task.objects.filter(
                    Q(owner=request.user) | Q(shared=True),
                    status__in=["published", "published_with_draft"],
                ).values(
                    "id", "name", "description", "status", "shared",
                    "task_type", "signature", "published_workspace",
                )
                return success_response(macros)
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))
