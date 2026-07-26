"""Regression tests for a task_detail authorization gap (offline, no real DB).

Run:
    poetry run python -m pytest testing/test_task_authorization.py -v

`task_detail`'s GET/PUT/DELETE (`backend/functions/libraries.py`) used to
look tasks up by raw id with no ownership filter at all — unlike
`get_task_list` in the same file, which already scopes to
`Q(owner=request.user) | Q(shared=True)`. Since Task ids are plain
sequential integers, any authenticated user could read, rename, or delete
another user's *private* (non-shared) task by guessing/enumerating its id —
an IDOR bypassing the exact visibility boundary the app already establishes
via the `shared` field and enforces in the list view.

GET is scoped to the same `Q(owner=...) | Q(shared=True)` visibility filter
as `get_task_list` (reads of a shared task are fine). DELETE/PUT are scoped
to `owner=request.user` only, **not** `| Q(shared=True)` — a first version of
this fix reused the read filter for mutations too, which let any
authenticated user delete/rename another user's *shared* task; the frontend
already restricts those actions to the owner (`listTasks.tsx`'s
`canManage`), so a visibility grant is not a mutation grant.
"""
import sys
import os
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

try:
    import django
    django.setup()
except Exception:
    pass

from django.db.models import Q
from django.test import RequestFactory

from backend.functions import libraries


class _FakeUser:
    def __init__(self, user_id):
        self.id = user_id
        self.is_authenticated = True


def _mock_task_objects(monkeypatch, first_return=None):
    mock_objects = MagicMock()
    mock_objects.filter.return_value.first.return_value = first_return
    monkeypatch.setattr(libraries.Task, "objects", mock_objects)
    return mock_objects


def test_task_detail_get_scopes_query_to_owner_or_shared(monkeypatch):
    mock_objects = _mock_task_objects(monkeypatch)
    user = _FakeUser(7)

    request = RequestFactory().get("/api/home/task/", {"id": "42"})
    request.user = user

    libraries.task_detail(request)

    args, kwargs = mock_objects.filter.call_args
    assert kwargs.get("id") == "42"
    assert (Q(owner=user) | Q(shared=True)) in args


def test_task_detail_delete_scopes_query_to_owner_only(monkeypatch):
    mock_objects = _mock_task_objects(monkeypatch)
    user = _FakeUser(7)

    request = RequestFactory().delete(
        "/api/home/task/", data='{"id": 42}', content_type="application/json"
    )
    request.user = user

    libraries.task_detail(request)

    args, kwargs = mock_objects.filter.call_args
    # owner=request.user only — NOT Q(shared=True): a visibility grant
    # (readable because shared) must not double as a mutation grant.
    assert args == ()
    assert kwargs == {"owner": user, "id": 42}


def test_task_detail_put_scopes_query_to_owner_only(monkeypatch):
    mock_objects = _mock_task_objects(monkeypatch)
    # shared: true takes the single-filter name-uniqueness branch
    # (`.filter(name=...).exclude(id=...)`, no `id` kwarg on that filter()
    # call) so it doesn't get confused with the update-targeting filter()
    # call under test, the only one carrying `id=`.
    mock_objects.filter.return_value.exclude.return_value = []
    mock_objects.filter.return_value.update.return_value = 0

    user = _FakeUser(7)
    monkeypatch.setattr(libraries.User.objects, "get", MagicMock(return_value=user))

    request = RequestFactory().put(
        "/api/home/task/",
        data='{"id": 42, "name": "renamed", "shared": true, "description": ""}',
        content_type="application/json",
    )
    request.user = user

    libraries.task_detail(request)

    update_call = next(
        c for c in mock_objects.filter.call_args_list if c.kwargs.get("id") == 42
    )
    assert update_call.args == ()
    assert update_call.kwargs == {"owner": user, "id": 42}


def test_task_detail_delete_returns_404_when_not_owned(monkeypatch):
    mock_objects = _mock_task_objects(monkeypatch)
    mock_objects.filter.return_value.exists.return_value = False
    user = _FakeUser(7)

    request = RequestFactory().delete(
        "/api/home/task/", data='{"id": 42}', content_type="application/json"
    )
    request.user = user

    response = libraries.task_detail(request)

    assert response.status_code == 404
    mock_objects.filter.return_value.delete.assert_not_called()


def test_task_detail_put_returns_404_when_not_owned(monkeypatch):
    mock_objects = _mock_task_objects(monkeypatch)
    mock_objects.filter.return_value.exclude.return_value = []
    mock_objects.filter.return_value.exists.return_value = False
    user = _FakeUser(7)
    monkeypatch.setattr(libraries.User.objects, "get", MagicMock(return_value=user))

    request = RequestFactory().put(
        "/api/home/task/",
        data='{"id": 42, "name": "renamed", "shared": true, "description": ""}',
        content_type="application/json",
    )
    request.user = user

    response = libraries.task_detail(request)

    assert response.status_code == 404
    mock_objects.filter.return_value.update.assert_not_called()


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
