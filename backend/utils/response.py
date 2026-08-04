from enum import Enum
from django.http import HttpResponse, JsonResponse
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


def bad_request(error, payload=None, status=400):
    return JsonResponse(
        {
            "message": error,
            "status": status,
            "timestamp": getDateTimeNow(),
            "payload": payload,
        },
        status=status,
    )


def accepted_response(message: str = "", data=None) -> HttpResponse:
    """202 — request understood but needs confirmation before it takes full
    effect (e.g. a breaking change requiring forcePublish). Not currently
    called anywhere: no publish path builds a breaking-changes check yet —
    see docs/internal/analisi-sistema/p2-2-ciclo-vita-task.md §5.5."""
    payload = {"message": message}
    if data is not None:
        payload["data"] = data
    return JsonResponse(payload, status=202)


def conflict_response(message: str = "", data=None) -> HttpResponse:
    """409 — request conflicts with current state (e.g. a dependency cycle).
    Not currently called anywhere: no publish path builds a DAG cycle check
    yet — see docs/internal/analisi-sistema/p2-2-ciclo-vita-task.md §5.5."""
    payload = {"message": message}
    if data is not None:
        payload["data"] = data
    return JsonResponse(payload, status=409)
