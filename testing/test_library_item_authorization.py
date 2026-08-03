"""Regression tests for an authorization gap on Object/Action/Location
DELETE and PUT (offline, no real DB).

Run:
    poetry run python -m pytest testing/test_library_item_authorization.py -v

`object_detail`/`action_detail`/`location_detail` (`backend/functions/libraries.py`)
used to look these rows up by raw id with no ownership filter at all on
DELETE/PUT — the same class of IDOR already fixed for `task_detail` in
`test_task_authorization.py`. Since ids are plain sequential integers, any
authenticated user could delete or overwrite another user's object/skill/
location, shared or not, by guessing its id.

GET is intentionally left unscoped (`.filter(id=...).first()`, no owner
filter) — object/skill/location detail views are meant to be readable
read-only by any authenticated user once shared, same as before this fix;
only the field list changed there (added `owner`/`owner__username`, see
`test_..._detail_get_includes_owner_fields` below). DELETE/PUT are scoped to
`owner=request.user` only, mirroring `task_detail`'s DELETE/PUT — a
visibility grant is not a mutation grant.
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

from django.test import RequestFactory

from backend.functions import libraries


class _FakeUser:
    def __init__(self, user_id):
        self.id = user_id
        self.is_authenticated = True


def _mock_objects(monkeypatch, model, first_return=None):
    mock_objects = MagicMock()
    mock_objects.filter.return_value.first.return_value = first_return
    monkeypatch.setattr(model, "objects", mock_objects)
    return mock_objects


# ─── Object ─────────────────────────────────────────────────────────────────


def test_object_detail_get_includes_owner_fields(monkeypatch):
    fake_object = MagicMock()
    fake_object.to_dict.return_value = {}
    _mock_objects(monkeypatch, libraries.Object, first_return=fake_object)
    user = _FakeUser(7)

    request = RequestFactory().get("/api/home/object/", {"id": "42"})
    request.user = user

    libraries.object_detail(request)

    requested_keys = fake_object.to_dict.call_args[0][0]
    assert "owner" in requested_keys
    assert "owner__username" in requested_keys


def test_object_detail_delete_scopes_query_to_owner_only(monkeypatch):
    mock_objects = _mock_objects(monkeypatch, libraries.Object)
    mock_objects.filter.return_value.exists.return_value = True
    user = _FakeUser(7)

    request = RequestFactory().delete(
        "/api/home/object/", data='{"id": 42}', content_type="application/json"
    )
    request.user = user

    libraries.object_detail(request)

    args, kwargs = mock_objects.filter.call_args
    assert args == ()
    assert kwargs == {"id": 42, "owner": user}


def test_object_detail_delete_returns_404_when_not_owned(monkeypatch):
    mock_objects = _mock_objects(monkeypatch, libraries.Object)
    mock_objects.filter.return_value.exists.return_value = False
    user = _FakeUser(7)

    request = RequestFactory().delete(
        "/api/home/object/", data='{"id": 42}', content_type="application/json"
    )
    request.user = user

    response = libraries.object_detail(request)

    assert response.status_code == 404
    mock_objects.filter.return_value.delete.assert_not_called()


def test_object_detail_put_scopes_query_to_owner_only(monkeypatch):
    mock_objects = _mock_objects(monkeypatch, libraries.Object)
    # name-uniqueness check branch runs first; keep it a no-op so we reach
    # the update-targeting filter() call under test.
    mock_objects.filter.return_value.exclude.return_value = []
    mock_objects.filter.return_value.exists.return_value = True
    user = _FakeUser(7)
    monkeypatch.setattr(libraries.User.objects, "get", MagicMock(return_value=user))

    request = RequestFactory().put(
        "/api/home/object/",
        data=(
            '{"id": 42, "name": "obj", "shared": true, "height": 1, "contour": "",'
            ' "photo": "", "shape": "", "force": 1, "keywords": [], "weight": 1,'
            ' "obj_length": 1, "obj_width": 1}'
        ),
        content_type="application/json",
    )
    request.user = user

    libraries.object_detail(request)

    update_call = next(
        c for c in mock_objects.filter.call_args_list if c.kwargs.get("id") == 42
    )
    assert update_call.args == ()
    assert update_call.kwargs == {"id": 42, "owner": user}


def test_object_detail_put_returns_404_when_not_owned(monkeypatch):
    mock_objects = _mock_objects(monkeypatch, libraries.Object)
    mock_objects.filter.return_value.exclude.return_value = []
    mock_objects.filter.return_value.exists.return_value = False
    user = _FakeUser(7)
    monkeypatch.setattr(libraries.User.objects, "get", MagicMock(return_value=user))

    request = RequestFactory().put(
        "/api/home/object/",
        data=(
            '{"id": 42, "name": "obj", "shared": true, "height": 1, "contour": "",'
            ' "photo": "", "shape": "", "force": 1, "keywords": [], "weight": 1,'
            ' "obj_length": 1, "obj_width": 1}'
        ),
        content_type="application/json",
    )
    request.user = user

    response = libraries.object_detail(request)

    assert response.status_code == 404
    mock_objects.filter.return_value.update.assert_not_called()


# ─── Action (Skill) ─────────────────────────────────────────────────────────


def test_action_detail_get_includes_owner_fields(monkeypatch):
    fake_action = MagicMock()
    fake_action.to_dict.return_value = {}
    _mock_objects(monkeypatch, libraries.Action, first_return=fake_action)
    user = _FakeUser(7)

    request = RequestFactory().get("/api/home/action/", {"id": "42"})
    request.user = user

    libraries.action_detail(request)

    requested_keys = fake_action.to_dict.call_args[0][0]
    assert "owner" in requested_keys
    assert "owner__username" in requested_keys


def test_action_detail_delete_scopes_query_to_owner_only(monkeypatch):
    mock_objects = _mock_objects(monkeypatch, libraries.Action)
    mock_objects.filter.return_value.exists.return_value = True
    user = _FakeUser(7)

    request = RequestFactory().delete(
        "/api/home/action/", data='{"id": 42}', content_type="application/json"
    )
    request.user = user

    libraries.action_detail(request)

    args, kwargs = mock_objects.filter.call_args
    assert args == ()
    assert kwargs == {"id": 42, "owner": user}


def test_action_detail_delete_returns_404_when_not_owned(monkeypatch):
    mock_objects = _mock_objects(monkeypatch, libraries.Action)
    mock_objects.filter.return_value.exists.return_value = False
    user = _FakeUser(7)

    request = RequestFactory().delete(
        "/api/home/action/", data='{"id": 42}', content_type="application/json"
    )
    request.user = user

    response = libraries.action_detail(request)

    assert response.status_code == 404
    mock_objects.filter.return_value.delete.assert_not_called()


def test_action_detail_put_scopes_query_to_owner_only(monkeypatch):
    mock_objects = _mock_objects(monkeypatch, libraries.Action)
    mock_objects.filter.return_value.exclude.return_value = []
    mock_objects.filter.return_value.exists.return_value = True
    user = _FakeUser(7)
    monkeypatch.setattr(libraries.User.objects, "get", MagicMock(return_value=user))

    request = RequestFactory().put(
        "/api/home/action/",
        data=(
            '{"id": 42, "name": "act", "shared": true, "speed": 1, "pattern": "L",'
            ' "points": "{}", "keywords": []}'
        ),
        content_type="application/json",
    )
    request.user = user

    libraries.action_detail(request)

    update_call = next(
        c for c in mock_objects.filter.call_args_list if c.kwargs.get("id") == 42
    )
    assert update_call.args == ()
    assert update_call.kwargs == {"id": 42, "owner": user}


def test_action_detail_put_returns_404_when_not_owned(monkeypatch):
    mock_objects = _mock_objects(monkeypatch, libraries.Action)
    mock_objects.filter.return_value.exclude.return_value = []
    mock_objects.filter.return_value.exists.return_value = False
    user = _FakeUser(7)
    monkeypatch.setattr(libraries.User.objects, "get", MagicMock(return_value=user))

    request = RequestFactory().put(
        "/api/home/action/",
        data=(
            '{"id": 42, "name": "act", "shared": true, "speed": 1, "pattern": "L",'
            ' "points": "{}", "keywords": []}'
        ),
        content_type="application/json",
    )
    request.user = user

    response = libraries.action_detail(request)

    assert response.status_code == 404
    mock_objects.filter.return_value.update.assert_not_called()


# ─── Location ───────────────────────────────────────────────────────────────


def test_location_detail_get_includes_owner_fields(monkeypatch):
    fake_location = MagicMock()
    fake_location.to_dict.return_value = {}
    _mock_objects(monkeypatch, libraries.Location, first_return=fake_location)
    user = _FakeUser(7)

    request = RequestFactory().get("/api/home/location/", {"id": "42"})
    request.user = user

    libraries.location_detail(request)

    requested_keys = fake_location.to_dict.call_args[0][0]
    assert "owner" in requested_keys
    assert "owner__username" in requested_keys


def test_location_detail_delete_scopes_query_to_owner_only(monkeypatch):
    mock_objects = _mock_objects(monkeypatch, libraries.Location)
    mock_objects.filter.return_value.exists.return_value = True
    user = _FakeUser(7)

    request = RequestFactory().delete(
        "/api/home/location/", data='{"id": 42}', content_type="application/json"
    )
    request.user = user

    libraries.location_detail(request)

    args, kwargs = mock_objects.filter.call_args
    assert args == ()
    assert kwargs == {"id": 42, "owner": user}


def test_location_detail_delete_returns_404_when_not_owned(monkeypatch):
    mock_objects = _mock_objects(monkeypatch, libraries.Location)
    mock_objects.filter.return_value.exists.return_value = False
    user = _FakeUser(7)

    request = RequestFactory().delete(
        "/api/home/location/", data='{"id": 42}', content_type="application/json"
    )
    request.user = user

    response = libraries.location_detail(request)

    assert response.status_code == 404
    mock_objects.filter.return_value.delete.assert_not_called()


def test_location_detail_put_scopes_query_to_owner_only(monkeypatch):
    mock_objects = _mock_objects(monkeypatch, libraries.Location)
    mock_objects.filter.return_value.exclude.return_value = []
    mock_objects.filter.return_value.exists.return_value = True
    user = _FakeUser(7)
    monkeypatch.setattr(libraries.User.objects, "get", MagicMock(return_value=user))

    request = RequestFactory().put(
        "/api/home/location/",
        data='{"id": 42, "name": "loc", "shared": true, "position": {}, "keywords": []}',
        content_type="application/json",
    )
    request.user = user

    libraries.location_detail(request)

    update_call = next(
        c for c in mock_objects.filter.call_args_list if c.kwargs.get("id") == 42
    )
    assert update_call.args == ()
    assert update_call.kwargs == {"id": 42, "owner": user}


def test_location_detail_put_returns_404_when_not_owned(monkeypatch):
    mock_objects = _mock_objects(monkeypatch, libraries.Location)
    mock_objects.filter.return_value.exclude.return_value = []
    mock_objects.filter.return_value.exists.return_value = False
    user = _FakeUser(7)
    monkeypatch.setattr(libraries.User.objects, "get", MagicMock(return_value=user))

    request = RequestFactory().put(
        "/api/home/location/",
        data='{"id": 42, "name": "loc", "shared": true, "position": {}, "keywords": []}',
        content_type="application/json",
    )
    request.user = user

    response = libraries.location_detail(request)

    assert response.status_code == 404
    mock_objects.filter.return_value.update.assert_not_called()


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
