from django.http import HttpResponse, HttpRequest
from json import loads
from backend.utils.response import (
    HttpMethod,
    invalid_request_method,
    error_response,
    success_response,
    unauthorized_request,
)
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.models import User, Group
from django.views.decorators.csrf import csrf_exempt


@csrf_exempt
def login_func(request: HttpRequest) -> HttpResponse:
    try:
        if request.method == HttpMethod.POST.value:
            data = loads(request.body)
            username: str = data.get("username")
            password: str = data.get("password")

            authError: bool = True
            data = {"authError": authError}

            user = authenticate(request, username=username, password=password)
            if user is not None:
                login(request, user)
                authError = False
                user = User.objects.get(id=user.id)
                group = Group.objects.filter(user=user).first()
                data = {
                    "authError": authError,
                    "username": username,
                    "id": user.id,
                    "group": group.name,
                }

            return success_response(data)
        else:
            return invalid_request_method()
    except Exception as e:
        return error_response(str(e))


def logout_func(request: HttpRequest) -> HttpResponse:
    try:
        if request.method == HttpMethod.POST.value:
            logout(request)
            return success_response()
        else:
            return invalid_request_method()
    except Exception as e:
        return error_response(str(e))


def verify_token(request: HttpRequest) -> HttpResponse:
    try:
        if request.method == HttpMethod.POST.value:
            data = loads(request.body)
            user_id: str = data.get("id")

            authError: bool = True
            response = {"authError": authError}

            if request.user.is_authenticated:
                user = User.objects.filter(id=user_id).first()
                if user is not None:
                    authError = False
                    group = Group.objects.filter(user=user).first()
                    response = {
                        "authError": authError,
                        "username": user.username,
                        "id": user.id,
                        "group": group.name,
                    }

            return success_response(response)
        else:
            return invalid_request_method()
    except Exception as e:
        return error_response(str(e))


def change_password(request: HttpRequest) -> HttpResponse:
    try:
        if request.user.is_authenticated:
            if request.method == HttpMethod.POST.value:
                data = loads(request.body)
                user_id = data.get("id")
                new_password = data.get("newPassword")
                old_password = data.get("oldPassword")

                if not request.user.check_password(old_password):
                    return success_response({"wrongPassword": True})

                user = User.objects.get(id=user_id)
                user.set_password(new_password)
                user.save()
                update_session_auth_hash(request, user)
                return success_response({"wrongPassword": False})
            else:
                return invalid_request_method()
        else:
            return unauthorized_request()
    except Exception as e:
        return error_response(str(e))
