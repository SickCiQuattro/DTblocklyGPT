from django.http import HttpResponse, HttpRequest
from backend.utils.response import (
    HttpMethod,
    invalid_request_method,
    error_response,
    success_response,
    unauthorized_request,
    bad_request,
)
from backend.models import Robot
from json import loads
from django.contrib.auth.models import User, Group
from django.db.models import OuterRef, Subquery
from django.contrib.auth import update_session_auth_hash


def get_user_list(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                users = (
                    User.objects.filter(is_superuser=False)
                    .values(
                        "id",
                        "username",
                        "last_login",
                        "email",
                        "is_active",
                        "date_joined",
                    )
                    .annotate(
                        role=Subquery(
                            Group.objects.filter(user=OuterRef("id")).values("name")[:1]
                        )
                    )
                )
                return success_response(users)
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def user_detail(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                user_id = request.GET.get("id")
                user = User.objects.filter(id=user_id).first()
                if user is None:
                    return success_response()
                group = user.groups.values("id")[0]["id"]
                user_fields = {}
                user_fields["id"] = user.id
                user_fields["username"] = user.username
                user_fields["first_name"] = user.first_name
                user_fields["last_name"] = user.last_name
                user_fields["email"] = user.email
                user_fields["role"] = group
                return success_response(user_fields)
            if request.method == HttpMethod.DELETE.value:
                data = loads(request.body)
                user_id = data.get("id")
                user_active = data.get("active")
                user = User.objects.filter(id=user_id).update(
                    is_active=user_active,
                )
                return success_response()
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                user_name = data.get("username")
                user_email = data.get("email")
                user_first_name = data.get("first_name")
                user_last_name = data.get("last_name")
                user_role = data.get("role")
                # check if the username already exists
                if User.objects.filter(username=user_name).exists():
                    data_result = {"usernameAlreadyExists": True}
                    return bad_request("Username already exists", data_result)

                new_user = User.objects.create(
                    username=user_name,
                    email=user_email,
                    first_name=user_first_name,
                    last_name=user_last_name,
                )
                new_user.set_password("test")
                new_user.save()
                update_session_auth_hash(request, new_user)
                group = Group.objects.get(id=user_role)
                group.user_set.add(new_user)
                return success_response()
            if request.method == HttpMethod.PUT.value:
                data = loads(request.body)
                user_id = data.get("id")
                user_name = data.get("username")
                user_email = data.get("email")
                user_first_name = data.get("first_name")
                user_last_name = data.get("last_name")
                user_role = data.get("role")
                # check if the username already exists
                if User.objects.filter(username=user_name).exclude(id=user_id).exists():
                    data_result = {"usernameAlreadyExists": True}
                    return bad_request("Username already exists", data_result)

                user = User.objects.filter(id=user_id)
                user.update(
                    username=user_name,
                    email=user_email,
                    first_name=user_first_name,
                    last_name=user_last_name,
                )
                user = User.objects.get(id=user_id)
                old_group_id = user.groups.values("id")[0]["id"]
                if old_group_id != user_role:
                    user.groups.clear()
                    old_group = Group.objects.get(id=old_group_id)
                    old_group.user_set.remove(user)
                    new_group = Group.objects.get(id=user_role)
                    new_group.user_set.add(user)
                return success_response()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def get_robot_list(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                robots = Robot.objects.values(
                    "id", "name", "ip", "model", "port", "cameraip"
                )
                return success_response(robots)
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def robot_detail(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                robot_id = request.GET.get("id")
                robot = Robot.objects.filter(id=robot_id).first()
                if robot is None:
                    return success_response()
                robot_fields = robot.to_dict(
                    [
                        "id",
                        "name",
                        "ip",
                        "model",
                        "port",
                        "cameraip",
                        "max_load",
                        "max_open_tool",
                    ]
                )
                return success_response(robot_fields)
            if request.method == HttpMethod.DELETE.value:
                data = loads(request.body)
                robot_id = data.get("id")
                robot = Robot.objects.filter(id=robot_id)
                robot.delete()
                return success_response()
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                robot_name = data.get("name")
                robot_ip = data.get("ip")
                robot_model = data.get("model")
                robot_port = data.get("port")
                robot_cameraip = data.get("cameraip")
                robot_max_load = data.get("max_load")
                robot_max_open_tool = data.get("max_open_tool")
                # check if the name already exists
                if Robot.objects.filter(name=robot_name).exists():
                    data_result = {"nameAlreadyExists": True}
                    return bad_request("Name already exists", data_result)
                Robot.objects.create(
                    name=robot_name,
                    ip=robot_ip,
                    model=robot_model,
                    port=robot_port,
                    cameraip=robot_cameraip,
                    max_load=robot_max_load,
                    max_open_tool=robot_max_open_tool,
                )
                return success_response()
            if request.method == HttpMethod.PUT.value:
                data = loads(request.body)
                robot_id = data.get("id")
                robot_name = data.get("name")
                robot_ip = data.get("ip")
                robot_model = data.get("model")
                robot_port = data.get("port")
                robot_cameraip = data.get("cameraip")
                robot_max_load = data.get("max_load")
                robot_max_open_tool = data.get("max_open_tool")
                # check if the name already exists
                if Robot.objects.filter(name=robot_name).exclude(id=robot_id).exists():
                    data_result = {"nameAlreadyExists": True}
                    return bad_request("Name already exists", data_result)

                Robot.objects.filter(id=robot_id).update(
                    name=robot_name,
                    ip=robot_ip,
                    model=robot_model,
                    port=robot_port,
                    cameraip=robot_cameraip,
                    max_load=robot_max_load,
                    max_open_tool=robot_max_open_tool,
                )
                return success_response()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def get_group_list(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.GET.value:
                groups = Group.objects.values("id", "name")
                return success_response(groups)
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))


def reset_password(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                user_id = data.get("id")
                user = User.objects.get(id=user_id)
                user.set_password("reset")
                user.save()
                update_session_auth_hash(request, user)
                return success_response()
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))
