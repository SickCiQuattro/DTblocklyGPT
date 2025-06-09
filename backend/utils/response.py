from enum import Enum
from django.http import JsonResponse
from django.db.models.query import QuerySet
from collections.abc import Sequence
from json import loads, dumps

from .date import getDateTimeNow


class HttpMethod(Enum):
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    DELETE = "DELETE"


def invalid_request_method():
    return error_response("Invalid request method", 405)


def unauthorized_request():
    return error_response("Unauthorized request", 401)


def success_response(data=None):
    payload = data
    if isinstance(data, QuerySet):
        payload = loads(dumps(list(data), default=str))

    payload = {"records": payload} if isinstance(payload, Sequence) else payload
    return JsonResponse(
        {
            "message": "OK",
            "status": 200,
            "timestamp": getDateTimeNow(),
            "payload": payload,
        },
        status=200,
    )


def error_response(error, status=500):
    return JsonResponse(
        {
            "message": error,
            "status": status,
            "timestamp": getDateTimeNow(),
            "payload": None,
        },
        status=status,
    )


def bad_request(error, payload, status=400):
    return JsonResponse(
        {
            "message": error,
            "status": status,
            "timestamp": getDateTimeNow(),
            "payload": payload,
        },
        status=status,
    )
