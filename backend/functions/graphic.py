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
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.PUT.value:
                data = loads(request.body)
                task_id = data.get("id")
                taskStructure = data.get("taskStructure")
                Task.objects.filter(id=task_id).update(code=dumps(taskStructure))
                return success_response()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def get_graphic_task(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                task_id = request.GET.get("id")
                task = Task.objects.filter(id=task_id).first()
                if task is None:
                    return success_response()

                if task.code is None:
                    response = {}
                    response["name"] = task.name
                    response["code"] = None
                    return success_response(response)

                _, updated_task_code = find_and_modify(
                    loads(task.code), "OBJECT", search_library_data, request.user.id
                )
                _, updated_task_code = find_and_modify(
                    updated_task_code, "LOCATION", search_library_data, request.user.id
                )
                _, updated_task_code = find_and_modify(
                    updated_task_code, "ACTION", search_library_data, request.user.id
                )

                response = {}
                response["name"] = task.name
                response["code"] = dumps(updated_task_code)
                return success_response(response)
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
