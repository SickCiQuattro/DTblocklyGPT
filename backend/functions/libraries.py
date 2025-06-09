from django.http import HttpResponse, HttpRequest
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
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                tasks = (
                    Task.objects.filter(Q(owner=request.user) | Q(shared=True))
                    .values(
                        "id",
                        "name",
                        "description",
                        "last_modified",
                        "owner",
                        "owner__username",
                        "shared",
                    )
                    .order_by("-last_modified")
                )
                return success_response(tasks)
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
                task = Task.objects.filter(id=task_id).first()
                if task is None:
                    return success_response()
                task_fields = task.to_dict(
                    [
                        "id",
                        "name",
                        "description",
                        "shared",
                        "code",
                    ]
                )
                return success_response(task_fields)
            if request.method == HttpMethod.DELETE.value:
                data = loads(request.body)
                task_id = data.get("id")
                task = Task.objects.filter(id=task_id)
                task.delete()
                return success_response()
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                task_name = data.get("name")
                task_shared = data.get("shared")
                task_description = data.get("description")
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

                Task.objects.filter(id=task_id).update(
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
                    "id", "name", "shared", "owner", "owner__username", "keywords"
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
                        "height",
                        "contour",
                        "photo",
                        "shape",
                        "keywords",
                        "force",
                    ]
                )
                return success_response(object_fields)
            if request.method == HttpMethod.DELETE.value:
                data = loads(request.body)
                object_id = data.get("id")
                object = Object.objects.filter(id=object_id)
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

                Object.objects.filter(id=object_id).update(
                    name=object_name,
                    shared=object_shared,
                    height=object_height,
                    contour=object_contour,
                    photo=object_photo,
                    shape=object_shape,
                    force=object_force,
                    keywords=object_keywords,
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
                action = Action.objects.filter(id=action_id)
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

                Action.objects.filter(id=action_id).update(
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
                        "position",
                        "keywords",
                    ]
                )
                return success_response(location_fields)
            if request.method == HttpMethod.DELETE.value:
                data = loads(request.body)
                location_id = data.get("id")
                location = Location.objects.filter(id=location_id)
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

                Location.objects.filter(id=location_id).update(
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
                    "id", "name", "robot__name", "robot"
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
