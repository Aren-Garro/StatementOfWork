"""Tests for setup/onboarding API endpoints."""
import os
from uuid import uuid4

import pytest

import app.models as models
from app import create_app


@pytest.fixture
def client(monkeypatch):
    db_path = models.DATABASE_PATH.replace("sow.db", f"sow_setup_test_{uuid4().hex}.db")
    monkeypatch.setattr(models, "DATABASE_PATH", db_path)
    app = create_app({"TESTING": True})
    yield app.test_client()
    if os.path.exists(db_path):
        os.remove(db_path)


def test_setup_status_returns_defaults(client):
    response = client.get("/api/setup/status")
    assert response.status_code == 200
    payload = response.get_json()
    assert "sharing" in payload
    assert "smtp" in payload
    assert "dependencies" in payload
    assert payload["sharing"]["default_plugin_url"].endswith("/plugin")


def test_setup_check_validates_smtp(client):
    response = client.post(
        "/api/setup/check",
        json={
            "sharing_plugin_url": "http://localhost:5000/plugin",
            "smtp": {
                "host": "",
                "from_email": "",
                "port": 587,
                "use_starttls": True,
                "use_ssl": True,
                "timeout_seconds": 10,
            },
            "check_smtp_connection": False,
            "check_plugin_health": False,
        },
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["smtp"]["valid"] is False
    assert payload["ready_to_save"] is False
    assert payload["smtp"]["issues"]


def test_setup_save_requires_valid_smtp(client):
    response = client.post(
        "/api/setup/save",
        json={
            "sharing_plugin_url": "http://localhost:5000/plugin",
            "smtp": {
                "host": "",
                "from_email": "",
                "port": 587,
                "use_starttls": True,
                "use_ssl": False,
                "timeout_seconds": 10,
            },
        },
    )
    assert response.status_code == 400
    assert "SMTP host is required" in response.get_json()["error"]


def test_setup_save_applies_runtime_env(client):
    response = client.post(
        "/api/setup/save",
        json={
            "sharing_plugin_url": "http://localhost:5000/plugin",
            "smtp": {
                "host": "smtp.example.com",
                "port": 587,
                "username": "user",
                "password": "pass",
                "from_email": "sender@example.com",
                "from_name": "SOW Creator",
                "use_starttls": True,
                "use_ssl": False,
                "timeout_seconds": 10,
            },
        },
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["setup_completed"] is True
    assert os.environ.get("SMTP_HOST") == "smtp.example.com"
    assert os.environ.get("SMTP_FROM_EMAIL") == "sender@example.com"
