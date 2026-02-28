"""Service layer for published-document email delivery."""
from __future__ import annotations

import re

from app.email_service import EmailConfigError, EmailSendError, send_published_doc_email
from app.services.publish_service import ServiceError, utc_now


EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


def _validated_email(to_email: str) -> str:
    normalized = (to_email or '').strip()
    if not EMAIL_RE.match(normalized):
        raise ServiceError('valid to_email is required', 400)
    return normalized


def _resolved_subject(subject: str, title: str) -> str:
    cleaned = (subject or '').strip()
    if cleaned:
        return cleaned
    return f"Statement of Work: {title}"


def send_published_email(
    *,
    row: dict,
    to_email: str,
    subject: str,
    message: str,
    attach_pdf: bool,
    host_url: str,
) -> dict:
    """Send published doc email and normalize delivery response."""
    to_email = _validated_email(to_email)
    view_url = f"{host_url.rstrip('/')}/p/{row['id']}"
    final_subject = _resolved_subject(subject, row['title'])

    try:
        delivery = send_published_doc_email(
            to_email=to_email,
            subject=final_subject,
            message=(message or '').strip(),
            title=row['title'],
            view_url=view_url,
            expires_at=row['expires_at'],
            signed=bool(row['signed']),
            attach_pdf=attach_pdf,
            html_content=row['html'],
            template_name=row.get('template') or 'modern',
            page_size=row.get('page_size') or 'Letter',
        )
    except EmailConfigError as exc:
        raise ServiceError(str(exc), 503) from exc
    except EmailSendError as exc:
        raise ServiceError(str(exc), 502) from exc

    return {
        'status': 'sent',
        'to_email': delivery['to_email'],
        'publish_id': row['id'],
        'attached_pdf': delivery['attached_pdf'],
        'sent_at': utc_now().isoformat(),
    }
