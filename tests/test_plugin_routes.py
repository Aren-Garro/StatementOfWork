"""Tests for optional sharing plugin endpoints."""
from datetime import datetime, timedelta, timezone

import pytest

import app.models as models
from app import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "sow_test.db"
    monkeypatch.setattr(models, "DATABASE_PATH", str(db_path))
    app = create_app({"TESTING": True})
    return app.test_client(), app


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


def test_publish_persists_metadata(client):
    test_client, app = client
    response = test_client.post(
        "/plugin/v1/publish",
        json={
            "title": "Signed SOW",
            "html": "<h1>X</h1><script>alert(1)</script>",
            "signed_only": True,
            "signed": True,
            "revision": 4,
            "jurisdiction": "US_NY",
        },
    )
    assert response.status_code == 201
    payload = response.get_json()
    assert payload["signed"] is True
    assert payload["revision"] == 4
    assert payload["jurisdiction"] == "US_NY"

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


def test_expired_link_and_cleanup(client):
    test_client, app = client
    expired_id = "expired1"
    now = datetime.now(timezone.utc)
    created_at = now.isoformat()
    expires_at = (now - timedelta(days=1)).isoformat()

    with app.app_context():
        db = models.get_db()
        db.execute(
            """INSERT INTO published_docs (id, title, html, created_at, expires_at, deleted, views, signed, jurisdiction)
               VALUES (?, ?, ?, ?, ?, 0, 0, 0, 'US_BASE')""",
            (expired_id, "Expired", "<p>old</p>", created_at, expires_at),
        )
        db.commit()

    public_resp = test_client.get(f"/p/{expired_id}")
    assert public_resp.status_code == 410

    cleanup = test_client.post("/plugin/v1/cleanup")
    assert cleanup.status_code == 200
    assert cleanup.get_json()["cleaned"] >= 1
