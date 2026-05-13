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
    - publish=True  → workspace = taskStructure, status = 'published'
    - publish=False (default) → workspace = taskStructure, status unchanged

    Never writes task_type (immutable after creation).
    Never writes published_workspace / draft_workspace (managed by macro endpoints).
    """
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.PUT.value:
                data = loads(request.body)
                task_id = data.get("id")
                taskStructure = data.get("taskStructure")
                publish = bool(data.get("publish", False))

                workspace_value = taskStructure  # None or dict

                update_fields = {"workspace": workspace_value}
                if publish:
                    update_fields["status"] = "published"

                Task.objects.filter(id=task_id).update(**update_fields)
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

    Read path:
    - macro_task  → published_workspace  (never exposes draft_workspace)
    - task        → workspace
    Fallback to loads(code) if the primary field is None (legacy).

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

                # ── Read path ─────────────────────────────────────────────────
                if task.task_type == "macro_task":
                    # Always serve the published version; the draft is only
                    # visible inside the macro's own editor session.
                    raw_workspace = task.published_workspace
                else:
                    raw_workspace = task.workspace

                if raw_workspace is None:
                    # Fallback to the legacy TextField
                    if task.code:
                        try:
                            raw_workspace = loads(task.code)
                        except Exception:
                            raw_workspace = None

                if raw_workspace is None:
                    return success_response({
                        "name": task.name,
                        "code": None,
                        "task_type": task.task_type,
                        "status": task.status,
                    })

                # ── Entity reconciliation (unchanged) ─────────────────────────
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
    # fix: shadow block not linked
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
    # Retrieving library data
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

    # In case of renaming
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
