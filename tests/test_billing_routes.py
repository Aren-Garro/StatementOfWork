"""Tests for billing integration adapter endpoints."""
from uuid import uuid4

import app.models as models
from app import create_app


def _make_client(monkeypatch):
    db_path = models.DATABASE_PATH.replace("sow.db", f"sow_billing_test_{uuid4().hex}.db")
    monkeypatch.setattr(models, "DATABASE_PATH", db_path)
    app = create_app({"TESTING": True})
    return app.test_client()


def test_billing_providers_list(monkeypatch):
    client = _make_client(monkeypatch)
    response = client.get("/api/integrations/billing/providers")
    assert response.status_code == 200
    payload = response.get_json()
    assert "providers" in payload
    names = {item["provider"] for item in payload["providers"]}
    assert {"stripe", "quickbooks"} <= names


def test_billing_sync_requires_array(monkeypatch):
    client = _make_client(monkeypatch)
    response = client.post(
        "/api/integrations/billing/sync",
        json={"provider": "stripe", "invoices": {"number": "INV-1"}},
    )
    assert response.status_code == 400
    assert "invoices" in response.get_json()["error"]


def test_billing_sync_rejects_unknown_provider(monkeypatch):
    client = _make_client(monkeypatch)
    response = client.post(
        "/api/integrations/billing/sync",
        json={"provider": "xero", "invoices": []},
    )
    assert response.status_code == 400
    assert "Unsupported billing provider" in response.get_json()["error"]


def test_billing_sync_summarizes_outstanding(monkeypatch):
    client = _make_client(monkeypatch)
    response = client.post(
        "/api/integrations/billing/sync",
        json={
            "provider": "stripe",
            "invoices": [
                {"number": "INV-100", "amount": 3000, "due_date": "2026-03-01", "status": "open"},
                {"number": "INV-101", "amount": 1500, "due_date": "2026-03-25", "status": "paid"},
            ],
        },
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["provider"] == "stripe"
    assert payload["synced_count"] == 2
    assert payload["outstanding_count"] == 1
    assert payload["total_outstanding"] == 3000.0


def test_billing_sync_rejects_non_object_invoice_row(monkeypatch):
    client = _make_client(monkeypatch)
    response = client.post(
        "/api/integrations/billing/sync",
        json={"provider": "stripe", "invoices": ["bad-row"]},
    )
    assert response.status_code == 400
    payload = response.get_json()
    assert payload["field"] == "invoices[0]"
    assert "object" in payload["message"]


def test_billing_sync_rejects_missing_invoice_number(monkeypatch):
    client = _make_client(monkeypatch)
    response = client.post(
        "/api/integrations/billing/sync",
        json={"provider": "stripe", "invoices": [{"amount": 10, "due_date": "2026-03-01", "status": "open"}]},
    )
    assert response.status_code == 400
    payload = response.get_json()
    assert payload["field"] == "invoices[0].number"


def test_billing_sync_rejects_invalid_due_date(monkeypatch):
    client = _make_client(monkeypatch)
    response = client.post(
        "/api/integrations/billing/sync",
        json={"provider": "stripe", "invoices": [{"number": "INV-1", "amount": 10, "due_date": "03/01/2026"}]},
    )
    assert response.status_code == 400
    payload = response.get_json()
    assert payload["field"] == "invoices[0].due_date"
    assert "YYYY-MM-DD" in payload["message"]
