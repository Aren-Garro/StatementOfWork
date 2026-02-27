"""Tests for template CRUD validation behavior."""
from uuid import uuid4

import app.models as models
from app import create_app


def _make_client(monkeypatch):
    db_path = models.DATABASE_PATH.replace("sow.db", f"sow_test_{uuid4().hex}.db")
    monkeypatch.setattr(models, "DATABASE_PATH", db_path)
    app = create_app({"TESTING": True})
    return app.test_client()


def test_create_template_requires_name(monkeypatch):
    client = _make_client(monkeypatch)
    response = client.post(
        "/api/templates",
        json={"markdown": "# title", "variables": {}},
    )
    assert response.status_code == 400
    assert "name" in response.get_json()["error"]


def test_create_template_requires_markdown(monkeypatch):
    client = _make_client(monkeypatch)
    response = client.post(
        "/api/templates",
        json={"name": "My Template", "markdown": "", "variables": {}},
    )
    assert response.status_code == 400
    assert "markdown" in response.get_json()["error"]


def test_create_template_validates_variables_type(monkeypatch):
    client = _make_client(monkeypatch)
    response = client.post(
        "/api/templates",
        json={"name": "My Template", "markdown": "# title", "variables": []},
    )
    assert response.status_code == 400
    assert "variables" in response.get_json()["error"]


def test_update_template_validates_variables_type(monkeypatch):
    client = _make_client(monkeypatch)
    created = client.post(
        "/api/templates",
        json={"name": "Base", "markdown": "# Base", "variables": {}},
    )
    template_id = created.get_json()["template"]["id"]

    response = client.put(
        f"/api/templates/{template_id}",
        json={"variables": []},
    )
    assert response.status_code == 400
    assert "variables" in response.get_json()["error"]
