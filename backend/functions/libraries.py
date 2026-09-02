from django.http import HttpResponse, HttpRequest
from backend.utils.task_summary import summarize_task
from backend.utils.response import (
    HttpMethod,
    invalid_request_method,
    error_response,
    success_response,
    unauthorized_request,
    bad_request,
)

from backend.models import Task, Object, UserRobot, Location, Action, Robot
from django.db.models import Q
from json import loads
from backend.utils.date import getDateTimeNow
from django.contrib.auth.models import User


def get_task_list(request: HttpRequest) -> HttpResponse:
    """Returns all tasks (and macro tasks) owned by or shared with the user.
    Used by the management UI — no status filter applied here.
    For the toolbox use get_published_macro_list instead.
    """
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                rows = (
                    Task.objects.filter(Q(owner=request.user) | Q(shared=True))
                    .only(
                        "id", "name", "description", "last_modified", "owner",
                        "shared", "task_type", "status", "signature",
                        "published_workspace", "draft_workspace",
                    )
                    .select_related("owner")
                    .order_by("-last_modified")
                )
                # `uses` is a handful of booleans derived from the workspace, not
                # the workspace itself: the card needs to say whether a program
                # moves the arm and what it waits for, and shipping the blocks to
                # say it would turn a ~5 KB list into hundreds.
                tasks = [
                    {
                        "id": t.id,
                        "name": t.name,
                        "description": t.description,
                        "last_modified": t.last_modified,
                        "owner": t.owner_id,
                        "owner__username": t.owner.username if t.owner else None,
                        "shared": t.shared,
                        "task_type": t.task_type,
                        "status": t.status,
                        "signature": t.signature,
                        "uses": summarize_task(t),
                    }
                    for t in rows
                ]
                return success_response(tasks)
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def get_published_macro_list(request: HttpRequest) -> HttpResponse:
    """
    GET api/macro/list/
    Returns only Macro Tasks that are visible in the toolbox:
    status IN ('published', 'published_with_draft').

    The response intentionally omits draft_workspace and workspace;
    published_workspace is served by get_graphic_task when the block
    is resolved inside the editor.
    """
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                macros = (
                    Task.objects.filter(
                        Q(owner=request.user) | Q(shared=True),
                        task_type="macro_task",
                        status__in=["published", "published_with_draft"],
                    )
                    .values(
                        "id",
                        "name",
                        "description",
                        "last_modified",
                        "owner",
                        "owner__username",
                        "shared",
                        "status",
                        "signature",
                    )
                    .order_by("-last_modified")
                )
                return success_response(macros)
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def task_detail(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                task_id = request.GET.get("id")
                # Same visibility boundary as get_task_list — a raw id lookup
                # with no filter let any authenticated user read another
                # user's private (non-shared) task by guessing/enumerating
                # its id, bypassing the exact owner-or-shared check that
                # already exists one function above in this file.
                task = Task.objects.filter(
                    Q(owner=request.user) | Q(shared=True), id=task_id
                ).first()
                if task is None:
                    return success_response()

                # Unified read path: draft_workspace > published_workspace > workspace > code(legacy)
                if task.draft_workspace is not None:
                    raw_workspace = task.draft_workspace
                elif task.published_workspace is not None:
                    raw_workspace = task.published_workspace
                elif task.workspace is not None:
                    raw_workspace = task.workspace
                elif task.code:
                    try:
                        from json import loads as _loads
                        raw_workspace = _loads(task.code)
                    except Exception:
                        raw_workspace = None
                else:
                    raw_workspace = None

                task_fields = {
                    "id": task.id,
                    "name": task.name,
                    "description": task.description,
                    "shared": task.shared,
                    "owner": task.owner_id,
                    "owner__username": task.owner.username,
                    "task_type": task.task_type,
                    "status": task.status,
                    "code": raw_workspace,
                    "signature": task.signature,
                    "last_modified": task.last_modified,
                }
                return success_response(task_fields)
            if request.method == HttpMethod.DELETE.value:
                data = loads(request.body)
                task_id = data.get("id")
                # Ownership only, unlike the GET above — Q(shared=True) is a
                # *visibility* boundary (get_task_list uses it for reads),
                # not a mutation grant. A first version of this fix reused
                # the read filter here too, which let any authenticated
                # user delete another user's shared task; the frontend
                # already restricts Delete/Edit to the owner
                # (listTasks.tsx's canManage), so the backend must match.
                task = Task.objects.filter(owner=request.user, id=task_id)
                if not task.exists():
                    return error_response("Task not found", status=404)
                task.delete()
                return success_response()
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                task_name = data.get("name")
                task_shared = data.get("shared")
                task_description = data.get("description")
                task_type = data.get("task_type", "task")
                task_owner = User.objects.get(id=request.user.id)
                date = getDateTimeNow()
                # check if the name already exists
                if task_shared is True:
                    tasks = Task.objects.filter(name=task_name)
                else:
                    tasks = Task.objects.filter(
                        Q(owner=task_owner) | Q(shared=True)
                    ).filter(name=task_name)

                if tasks:
                    data_result = {"nameAlreadyExists": True}
                    return bad_request("Name already exists", data_result)

                task_created = Task.objects.create(
                    name=task_name,
                    owner=task_owner,
                    description=task_description,
                    shared=task_shared,
                    last_modified=date,
                    task_type=task_type,
                )
                response = {"id": task_created.id}
                return success_response(response)
            if request.method == HttpMethod.PUT.value:
                data = loads(request.body)
                task_id = data.get("id")
                task_name = data.get("name")
                task_shared = data.get("shared")
                task_description = data.get("description")
                task_owner = User.objects.get(id=request.user.id)
                date = getDateTimeNow()
                # check if the name already exists
                if task_shared is True:
                    tasks = Task.objects.filter(name=task_name).exclude(id=task_id)
                else:
                    tasks = (
                        Task.objects.filter(Q(owner=task_owner) | Q(shared=True))
                        .filter(name=task_name)
                        .exclude(id=task_id)
                    )

                if tasks:
                    data_result = {"nameAlreadyExists": True}
                    return bad_request("Name already exists", data_result)

                # task_type is immutable after creation — never updated here.
                # Ownership only for the mutation itself — see the DELETE
                # branch above for why Q(shared=True) doesn't belong here.
                task_qs = Task.objects.filter(owner=task_owner, id=task_id)
                if not task_qs.exists():
                    return error_response("Task not found", status=404)
                task_qs.update(
                    name=task_name,
                    description=task_description,
                    shared=task_shared,
                    last_modified=date,
                )
                return success_response()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def get_object_list(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                user = User.objects.get(id=request.user.id)
                objects = Object.objects.filter(Q(owner=user) | Q(shared=True)).values(
                    "id",
                    "name",
                    "shared",
                    "owner",
                    "owner__username",
                    "keywords",
                    "obj_length",
                    "obj_width",
                    "weight",
                )
                return success_response(objects)
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def object_detail(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                object_id = request.GET.get("id")
                object = Object.objects.filter(id=object_id).first()
                if object is None:
                    return success_response()
                object_fields = object.to_dict(
                    [
                        "id",
                        "name",
                        "shared",
                        "owner",
                        "owner__username",
                        "height",
                        "contour",
                        "photo",
                        "shape",
                        "keywords",
                        "force",
                        "weight",
                        "obj_width",
                        "obj_length",
                    ]
                )
                return success_response(object_fields)
            if request.method == HttpMethod.DELETE.value:
                data = loads(request.body)
                object_id = data.get("id")
                # Ownership only, same reasoning as task_detail's DELETE — a
                # raw id-only filter let any authenticated user delete
                # another user's object, shared or not, by guessing its id.
                object = Object.objects.filter(id=object_id, owner=request.user)
                if not object.exists():
                    return error_response("Object not found", status=404)
                object.delete()
                return success_response()
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                object_name = data.get("name")
                object_shared = data.get("shared")
                object_height = data.get("height")
                object_contour = data.get("contour")
                object_photo = data.get("photo")
                object_shape = data.get("shape")
                object_force = data.get("force")
                object_keywords = data.get("keywords")
                object_weight = data.get("weight")
                object_length = data.get("obj_length")
                object_width = data.get("obj_width")
                object_owner = User.objects.get(id=request.user.id)
                # check if the name already exists
                if object_shared is True:
                    objects = Object.objects.filter(name=object_name)
                else:
                    objects = Object.objects.filter(
                        Q(owner=object_owner) | Q(shared=True)
                    ).filter(name=object_name)

                if objects:
                    data_result = {"nameAlreadyExists": True}
                    return bad_request("Name already exists", data_result)

                # check if object name is used as keyword
                if object_shared is True:
                    objectsOfUser = Object.objects.all()
                else:
                    objectsOfUser = Object.objects.filter(
                        Q(owner=request.user.id) | Q(shared=True)
                    )
                nameKeywordExist = False
                keywordExist = False
                keywordsFound = []
                for object in objectsOfUser:
                    keywordsOld = object.keywords
                    if keywordsOld is None:
                        continue
                    keywordsOld = [keyword.strip() for keyword in keywordsOld]
                    keywordsNew = [keyword.strip() for keyword in object_keywords]
                    if object_name in keywordsOld:
                        nameKeywordExist = True
                    for keywordOld in keywordsOld:
                        for keywordNew in keywordsNew:
                            if keywordNew == keywordOld:
                                keywordsFound.append(keywordNew)
                                keywordExist = True

                if nameKeywordExist:
                    data_result = {"nameAlreadyExists": True}
                    return bad_request("Name already exists", data_result)

                if keywordExist:
                    data_result = {"keywordExist": True, "keywordFound": keywordsFound}
                    return bad_request("Keyword already exists", data_result)

                Object.objects.create(
                    name=object_name,
                    owner=object_owner,
                    shared=object_shared,
                    height=object_height,
                    contour=object_contour,
                    photo=object_photo,
                    shape=object_shape,
                    force=object_force,
                    keywords=object_keywords,
                    weight=object_weight,
                    obj_length=object_length,
                    obj_width=object_width,
                )
                return success_response()
            if request.method == HttpMethod.PUT.value:
                data = loads(request.body)
                object_id = data.get("id")
                object_name = data.get("name")
                object_shared = data.get("shared")
                object_height = data.get("height")
                object_contour = data.get("contour")
                object_photo = data.get("photo")
                object_shape = data.get("shape")
                object_force = data.get("force")
                object_keywords = data.get("keywords")
                object_weight = data.get("weight")
                object_length = data.get("obj_length")
                object_width = data.get("obj_width")
                object_owner = User.objects.get(id=request.user.id)
                # check if the name already exists
                if object_shared is True:
                    objects = Object.objects.filter(name=object_name).exclude(
                        id=object_id
                    )
                else:
                    objects = (
                        Object.objects.filter(Q(owner=object_owner) | Q(shared=True))
                        .filter(name=object_name)
                        .exclude(id=object_id)
                    )

                if objects:
                    data_result = {"nameAlreadyExists": True}
                    return bad_request("Name already exists", data_result)

                # check if object name is used as keyword
                if object_shared is True:
                    objectsOfUser = Object.objects.all().exclude(id=object_id)
                else:
                    objectsOfUser = Object.objects.filter(
                        Q(owner=request.user.id) | Q(shared=True)
                    ).exclude(id=object_id)
                nameKeywordExist = False
                keywordExist = False
                keywordsFound = []
                for object in objectsOfUser:
                    keywordsOld = object.keywords
                    if keywordsOld is None:
                        continue
                    keywordsOld = [keyword.strip() for keyword in keywordsOld]
                    keywordsNew = [keyword.strip() for keyword in object_keywords]
                    if object_name in keywordsOld:
                        nameKeywordExist = True
                    for keywordOld in keywordsOld:
                        for keywordNew in keywordsNew:
                            if keywordNew == keywordOld:
                                keywordsFound.append(keywordNew)
                                keywordExist = True

                if nameKeywordExist:
                    data_result = {"nameAlreadyExists": True}
                    return bad_request("Name already exists", data_result)

                if keywordExist:
                    data_result = {"keywordExist": True, "keywordFound": keywordsFound}
                    return bad_request("Keyword already exists", data_result)

                object_qs = Object.objects.filter(id=object_id, owner=request.user)
                if not object_qs.exists():
                    return error_response("Object not found", status=404)
                object_qs.update(
                    name=object_name,
                    shared=object_shared,
                    height=object_height,
                    contour=object_contour,
                    photo=object_photo,
                    shape=object_shape,
                    force=object_force,
                    keywords=object_keywords,
                    weight=object_weight,
                    obj_length=object_length,
                    obj_width=object_width,
                )
                return success_response()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def get_action_list(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                user = User.objects.get(id=request.user.id)
                actions = Action.objects.filter(Q(owner=user) | Q(shared=True)).values(
                    "id",
                    "name",
                    "shared",
                    "owner",
                    "owner__username",
                    "keywords",
                )
                return success_response(actions)
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def action_detail(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                action_id = request.GET.get("id")
                action = Action.objects.filter(id=action_id).first()
                if action is None:
                    return success_response()
                action_fields = action.to_dict(
                    [
                        "id",
                        "name",
                        "shared",
                        "owner",
                        "owner__username",
                        "speed",
                        "pattern",
                        "height",
                        "points",
                        "keywords",
                    ]
                )
                return success_response(action_fields)
            if request.method == HttpMethod.DELETE.value:
                data = loads(request.body)
                action_id = data.get("id")
                action = Action.objects.filter(id=action_id, owner=request.user)
                if not action.exists():
                    return error_response("Skill not found", status=404)
                action.delete()
                return success_response()
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                action_name = data.get("name")
                action_shared = data.get("shared")
                action_owner = User.objects.get(id=request.user.id)
                action_speed = data.get("speed")
                action_pattern = data.get("pattern")
                action_points = data.get("points")
                action_keywords = data.get("keywords")
                # check if the name already exists
                if action_shared is True:
                    actions = Action.objects.filter(name=action_name)
                else:
                    actions = Action.objects.filter(
                        Q(owner=action_owner) | Q(shared=True)
                    ).filter(name=action_name)

                if actions:
                    data_result = {"nameAlreadyExists": True}
                    return bad_request("Name already exists", data_result)

                # check if action name is used as keyword
                if action_shared is True:
                    actionsOfUser = Action.objects.all()
                else:
                    actionsOfUser = Action.objects.filter(
                        Q(owner=request.user.id) | Q(shared=True)
                    )
                nameKeywordExist = False
                keywordExist = False
                keywordsFound = []
                for object in actionsOfUser:
                    keywordsOld = object.keywords
                    if keywordsOld is None:
                        continue
                    keywordsOld = [keyword.strip() for keyword in keywordsOld]
                    keywordsNew = [keyword.strip() for keyword in action_keywords]
                    if action_name in keywordsOld:
                        nameKeywordExist = True
                    for keywordOld in keywordsOld:
                        for keywordNew in keywordsNew:
                            if keywordNew == keywordOld:
                                keywordsFound.append(keywordNew)
                                keywordExist = True

                if nameKeywordExist:
                    data_result = {"nameAlreadyExists": True}
                    return bad_request("Name already exists", data_result)

                if keywordExist:
                    data_result = {"keywordExist": True, "keywordFound": keywordsFound}
                    return bad_request("Keyword already exists", data_result)

                Action.objects.create(
                    name=action_name,
                    owner=action_owner,
                    shared=action_shared,
                    speed=action_speed,
                    pattern=action_pattern,
                    points=action_points,
                    keywords=action_keywords,
                )
                return success_response()
            if request.method == HttpMethod.PUT.value:
                data = loads(request.body)
                action_id = data.get("id")
                action_name = data.get("name")
                action_shared = data.get("shared")
                action_owner = User.objects.get(id=request.user.id)
                action_speed = data.get("speed")
                action_pattern = data.get("pattern")
                action_points = data.get("points")
                action_keywords = data.get("keywords")
                # check if the name already exists
                if action_shared is True:
                    actions = Action.objects.filter(name=action_name).exclude(
                        id=action_id
                    )
                else:
                    actions = (
                        Action.objects.filter(Q(owner=action_owner) | Q(shared=True))
                        .filter(name=action_name)
                        .exclude(id=action_id)
                    )

                if actions:
                    data_result = {"nameAlreadyExists": True}
                    return bad_request("Name already exists", data_result)

                # check if action name is used as keyword
                if action_shared is True:
                    actionsOfUser = Action.objects.all().exclude(id=action_id)
                else:
                    actionsOfUser = Action.objects.filter(
                        Q(owner=request.user.id) | Q(shared=True)
                    ).exclude(id=action_id)
                nameKeywordExist = False
                keywordExist = False
                keywordsFound = []
                for object in actionsOfUser:
                    keywordsOld = object.keywords
                    if keywordsOld is None:
                        continue
                    keywordsOld = [keyword.strip() for keyword in keywordsOld]
                    keywordsNew = [keyword.strip() for keyword in action_keywords]
                    if action_name in keywordsOld:
                        nameKeywordExist = True
                    for keywordOld in keywordsOld:
                        for keywordNew in keywordsNew:
                            if keywordNew == keywordOld:
                                keywordsFound.append(keywordNew)
                                keywordExist = True

                if nameKeywordExist:
                    data_result = {"nameAlreadyExists": True}
                    return bad_request("Name already exists", data_result)

                if keywordExist:
                    data_result = {"keywordExist": True, "keywordFound": keywordsFound}
                    return bad_request("Keyword already exists", data_result)

                action_qs = Action.objects.filter(id=action_id, owner=request.user)
                if not action_qs.exists():
                    return error_response("Skill not found", status=404)
                action_qs.update(
                    name=action_name,
                    shared=action_shared,
                    speed=action_speed,
                    pattern=action_pattern,
                    points=action_points,
                    keywords=action_keywords,
                )
                return success_response()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def get_location_list(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                user = User.objects.get(id=request.user.id)
                locations = Location.objects.filter(
                    Q(owner=user) | Q(shared=True)
                ).values("id", "name", "shared", "owner", "owner__username", "keywords")
                return success_response(locations)
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def location_detail(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                location_id = request.GET.get("id")
                location = Location.objects.filter(id=location_id).first()
                if location is None:
                    return success_response()
                location_fields = location.to_dict(
                    [
                        "id",
                        "name",
                        "shared",
                        "owner",
                        "owner__username",
                        "position",
                        "keywords",
                    ]
                )
                return success_response(location_fields)
            if request.method == HttpMethod.DELETE.value:
                data = loads(request.body)
                location_id = data.get("id")
                location = Location.objects.filter(id=location_id, owner=request.user)
                if not location.exists():
                    return error_response("Location not found", status=404)
                location.delete()
                return success_response()
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                location_name = data.get("name")
                location_shared = data.get("shared")
                location_position = data.get("position")
                location_owner = User.objects.get(id=request.user.id)
                location_keywords = data.get("keywords")

                # check if the name already exists
                if location_shared is True:
                    locations = Location.objects.filter(name=location_name)
                else:
                    locations = Location.objects.filter(
                        Q(owner=location_owner) | Q(shared=True)
                    ).filter(name=location_name)

                if locations:
                    data_result = {"nameAlreadyExists": True}
                    return bad_request("Name already exists", data_result)

                # check if location name is used as keyword
                if location_shared is True:
                    locationsOfUser = Location.objects.all()
                else:
                    locationsOfUser = Location.objects.filter(
                        Q(owner=request.user.id) | Q(shared=True)
                    )
                nameKeywordExist = False
                keywordExist = False
                keywordsFound = []
                for object in locationsOfUser:
                    keywordsOld = object.keywords
                    if keywordsOld is None:
                        continue
                    keywordsOld = [keyword.strip() for keyword in keywordsOld]
                    keywordsNew = [keyword.strip() for keyword in location_keywords]
                    if location_name in keywordsOld:
                        nameKeywordExist = True
                    for keywordOld in keywordsOld:
                        for keywordNew in keywordsNew:
                            if keywordNew == keywordOld:
                                keywordsFound.append(keywordNew)
                                keywordExist = True

                if nameKeywordExist:
                    data_result = {"nameAlreadyExists": True}
                    return bad_request("Name already exists", data_result)

                if keywordExist:
                    data_result = {"keywordExist": True, "keywordFound": keywordsFound}
                    return bad_request("Keyword already exists", data_result)

                Location.objects.create(
                    name=location_name,
                    owner=location_owner,
                    shared=location_shared,
                    position=location_position,
                    keywords=location_keywords,
                )
                return success_response()
            if request.method == HttpMethod.PUT.value:
                data = loads(request.body)
                location_id = data.get("id")
                location_name = data.get("name")
                location_shared = data.get("shared")
                location_owner = User.objects.get(id=request.user.id)
                location_position = data.get("position")
                location_keywords = data.get("keywords")

                # check if the name already exists
                if location_shared is True:
                    locations = Location.objects.filter(name=location_name).exclude(
                        id=location_id
                    )
                else:
                    locations = (
                        Location.objects.filter(
                            Q(owner=location_owner) | Q(shared=True)
                        )
                        .filter(name=location_name)
                        .exclude(id=location_id)
                    )

                if locations:
                    data_result = {"nameAlreadyExists": True}
                    return bad_request("Name already exists", data_result)

                # check if location name is used as keyword
                if location_shared is True:
                    locationsOfUser = Location.objects.all().exclude(id=location_id)
                else:
                    locationsOfUser = Location.objects.filter(
                        Q(owner=request.user.id) | Q(shared=True)
                    ).exclude(id=location_id)
                nameKeywordExist = False
                keywordExist = False
                keywordsFound = []
                for object in locationsOfUser:
                    keywordsOld = object.keywords
                    if keywordsOld is None:
                        continue
                    keywordsOld = [keyword.strip() for keyword in keywordsOld]
                    keywordsNew = [keyword.strip() for keyword in location_keywords]
                    if location_name in keywordsOld:
                        nameKeywordExist = True
                    for keywordOld in keywordsOld:
                        for keywordNew in keywordsNew:
                            if keywordNew == keywordOld:
                                keywordsFound.append(keywordNew)
                                keywordExist = True

                if nameKeywordExist:
                    data_result = {"nameAlreadyExists": True}
                    return bad_request("Name already exists", data_result)

                if keywordExist:
                    data_result = {"keywordExist": True, "keywordFound": keywordsFound}
                    return bad_request("Keyword already exists", data_result)

                location_qs = Location.objects.filter(id=location_id, owner=request.user)
                if not location_qs.exists():
                    return error_response("Location not found", status=404)
                location_qs.update(
                    name=location_name,
                    shared=location_shared,
                    position=location_position,
                    keywords=location_keywords,
                )
                return success_response()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def get_my_robot_list(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                username = request.user
                user = User.objects.get(username=username)
                myRobots = UserRobot.objects.filter(Q(user=user)).values(
                    "id",
                    "name",
                    "robot__name",
                    "robot",
                    "robot__max_load",
                    "robot__max_open_tool",
                )
                return success_response(myRobots)
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def my_robot_detail(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                myRobot_id = request.GET.get("id")
                myRobot = UserRobot.objects.filter(id=myRobot_id).first()
                if myRobot is None:
                    return success_response()
                myRobot_fields = myRobot.to_dict(["id", "name", "robot"])
                return success_response(myRobot_fields)
            if request.method == HttpMethod.DELETE.value:
                data = loads(request.body)
                myRobot_id = data.get("id")
                myRobot = UserRobot.objects.filter(id=myRobot_id)
                myRobot.delete()
                return success_response()
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                myRobot_name = data.get("name")
                myRobot_robot_id = data.get("robot")
                myRobot_user = User.objects.get(id=request.user.id)
                # check if the name already exists
                if UserRobot.objects.filter(
                    name=myRobot_name, user=myRobot_user
                ).exists():
                    data_result = {"nameAlreadyExists": True}
                    return bad_request("Name already exists", data_result)

                myRobot_robot = Robot.objects.get(id=myRobot_robot_id)
                UserRobot.objects.create(
                    name=myRobot_name, user=myRobot_user, robot=myRobot_robot
                )
                return success_response()
            if request.method == HttpMethod.PUT.value:
                data = loads(request.body)
                myRobot_id = data.get("id")
                myRobot_name = data.get("name")
                user = User.objects.get(id=request.user.id)
                # check if the name already exists
                if (
                    UserRobot.objects.filter(name=myRobot_name)
                    .exclude(user=user)
                    .exists()
                ):
                    data_result = {"nameAlreadyExists": True}
                    return bad_request("Name already exists", data_result)

                UserRobot.objects.filter(id=myRobot_id).update(
                    name=myRobot_name,
                )
                return success_response()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))
