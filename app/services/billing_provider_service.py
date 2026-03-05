"""Billing provider adapter interfaces and mock-backed service helpers."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Protocol


@dataclass
class InvoiceRecord:
    """Normalized invoice shape used by adapter interfaces."""

    number: str
    amount: float
    due_date: str
    status: str = "open"


class BillingProviderAdapter(Protocol):
    """Adapter contract for billing providers."""

    provider_name: str

    def create_invoice(self, invoice: InvoiceRecord) -> dict:
        """Create an invoice record in provider format."""

    def sync_payment_status(self, invoices: list[InvoiceRecord]) -> list[dict]:
        """Refresh payment status for known invoices."""

    def list_outstanding(self, invoices: list[InvoiceRecord]) -> list[dict]:
        """List currently open invoices."""


class _BaseAdapter:
    provider_name = "base"

    def create_invoice(self, invoice: InvoiceRecord) -> dict:
        return {
            "provider": self.provider_name,
            "invoice_number": invoice.number,
            "amount": round(float(invoice.amount), 2),
            "due_date": invoice.due_date,
            "status": invoice.status,
        }

    def sync_payment_status(self, invoices: list[InvoiceRecord]) -> list[dict]:
        return [self.create_invoice(invoice) for invoice in invoices]

    def list_outstanding(self, invoices: list[InvoiceRecord]) -> list[dict]:
        return [self.create_invoice(invoice) for invoice in invoices if invoice.status != "paid"]


class StripeAdapter(_BaseAdapter):
    provider_name = "stripe"


class QuickBooksAdapter(_BaseAdapter):
    provider_name = "quickbooks"


_ADAPTERS: dict[str, BillingProviderAdapter] = {
    "stripe": StripeAdapter(),
    "quickbooks": QuickBooksAdapter(),
}


def available_providers() -> list[dict]:
    """Return provider metadata for UI discovery."""
    return [
        {
            "provider": "stripe",
            "label": "Stripe",
            "capabilities": ["create_invoice", "sync_payment_status", "list_outstanding"],
        },
        {
            "provider": "quickbooks",
            "label": "QuickBooks",
            "capabilities": ["create_invoice", "sync_payment_status", "list_outstanding"],
        },
    ]


def _parse_invoice(raw: dict) -> InvoiceRecord:
    number = str(raw.get("number", "")).strip()
    due_date = str(raw.get("due_date", "")).strip()
    amount = float(raw.get("amount", 0) or 0)
    status = str(raw.get("status", "open") or "open").strip().lower()
    return InvoiceRecord(number=number, amount=amount, due_date=due_date, status=status)


def sync_provider_invoices(provider: str, raw_invoices: list[dict]) -> dict:
    """Normalize and summarize invoice state for a provider."""
    key = (provider or "").strip().lower()
    if key not in _ADAPTERS:
        raise ValueError("Unsupported billing provider")

    adapter = _ADAPTERS[key]
    invoices = [_parse_invoice(item) for item in raw_invoices if isinstance(item, dict)]
    synced = adapter.sync_payment_status(invoices)
    outstanding = adapter.list_outstanding(invoices)
    due_now = sum(1 for row in outstanding if _is_due_or_overdue(row.get("due_date", "")))
    total_outstanding = sum(float(row.get("amount", 0) or 0) for row in outstanding)
    return {
        "provider": key,
        "synced_count": len(synced),
        "outstanding_count": len(outstanding),
        "due_now_count": due_now,
        "total_outstanding": round(total_outstanding, 2),
        "outstanding_invoices": outstanding,
    }


def _is_due_or_overdue(due_date: str) -> bool:
    if not due_date:
        return False
    try:
        due = date.fromisoformat(due_date)
    except ValueError:
        return False
    return due <= date.today()

