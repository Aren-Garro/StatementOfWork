"""Tests for optional sharing plugin endpoints."""
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

import app.models as models
from app import create_app


@pytest.fixture
def client(monkeypatch):
    db_path = models.DATABASE_PATH.replace("sow.db", f"sow_plugin_test_{uuid4().hex}.db")
    monkeypatch.setattr(models, "DATABASE_PATH", db_path)
    app = create_app({"TESTING": True})
    yield app.test_client(), app
    if os.path.exists(db_path):
        os.remove(db_path)


def test_publish_requires_signed_when_signed_only(client):
    test_client, _ = client
    response = test_client.post(
        "/plugin/v1/publish",
        json={
            "title": "Test",
            "html": "<h1>Hello</h1>",
            "signed_only": True,
            "signed": False,
        },
    )
    assert response.status_code == 400
    assert "signed_only" in response.get_json()["error"]


def test_publish_rejects_invalid_jurisdiction(client):
    test_client, _ = client
    response = test_client.post(
        "/plugin/v1/publish",
        json={
            "title": "Invalid Jurisdiction",
            "html": "<h1>Hello</h1>",
            "jurisdiction": "US_TX",
        },
    )
    assert response.status_code == 400
    assert "jurisdiction" in response.get_json()["error"]


@pytest.mark.parametrize(
    "jurisdiction",
    ["EU_BASE", "UK_BASE", "CA_BASE", "AU_BASE"],
)
def test_publish_accepts_new_jurisdictions(client, jurisdiction):
    test_client, _ = client
    response = test_client.post(
        "/plugin/v1/publish",
        json={
            "title": "Valid Jurisdiction",
            "html": "<h1>Hello</h1>",
            "jurisdiction": jurisdiction,
        },
    )
    assert response.status_code == 201
    payload = response.get_json()
    assert payload["jurisdiction"] == jurisdiction


def test_publish_parses_boolean_strings(client):
    test_client, _ = client
    response = test_client.post(
        "/plugin/v1/publish",
        json={
            "title": "Bool Parse",
            "html": "<h1>Hello</h1>",
            "signed_only": "true",
            "signed": "false",
        },
    )
    assert response.status_code == 400
    assert "signed_only" in response.get_json()["error"]


def test_publish_persists_metadata(client):
    test_client, app = client
    response = test_client.post(
        "/plugin/v1/publish",
        json={
            "title": "Signed SOW",
            "html": "<h1 onclick='x()'>X</h1><a href=\"javascript:alert(1)\">Go</a><script>alert(1)</script>",
            "signed_only": True,
            "signed": True,
            "revision": 4,
            "jurisdiction": "US_NY",
            "strict_sanitize": False,
        },
    )
    assert response.status_code == 201
    payload = response.get_json()
    assert payload["signed"] is True
    assert payload["revision"] == 4
    assert payload["jurisdiction"] == "US_NY"
    assert payload["sanitized"] is True

    publish_id = payload["publish_id"]

    meta = test_client.get(f"/plugin/v1/p/{publish_id}")
    assert meta.status_code == 200
    document = meta.get_json()["document"]
    assert document["signed"] == 1
    assert document["revision"] == 4
    assert document["jurisdiction"] == "US_NY"

    with app.app_context():
        db = models.get_db()
        row = db.execute("SELECT html FROM published_docs WHERE id = ?", (publish_id,)).fetchone()
        assert "<script" not in row["html"].lower()
        assert "onclick" not in row["html"].lower()
        assert "javascript:" not in row["html"].lower()


def test_expired_link_and_cleanup(client):
    test_client, app = client
    expired_id = "expired1"
    now = datetime.now(timezone.utc)
    created_at = now.isoformat()
    expires_at = (now - timedelta(days=1)).isoformat()

    with app.app_context():
        db = models.get_db()
        db.execute(
            """INSERT INTO published_docs
               (id, title, html, created_at, expires_at, deleted, views, signed, jurisdiction)
               VALUES (?, ?, ?, ?, ?, 0, 0, 0, 'US_BASE')""",
            (expired_id, "Expired", "<p>old</p>", created_at, expires_at),
        )
        db.commit()

    public_resp = test_client.get(f"/p/{expired_id}")
    assert public_resp.status_code == 410

    cleanup = test_client.post("/plugin/v1/cleanup")
    assert cleanup.status_code == 200
    data = cleanup.get_json()
    assert data["cleaned"] >= 1
    assert data["scanned"] >= 1
    assert data["timestamp"]
