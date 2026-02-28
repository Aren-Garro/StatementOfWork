"""Service layer for published document workflows."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import secrets


@dataclass
class ServiceError(Exception):
    """Base typed service error mapped to HTTP status codes."""
    message: str
    status_code: int

    def __str__(self) -> str:
        return self.message


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def create_published_document(
    *,
    db,
    title: str,
    sanitized_html: str,
    expires_in_days: int,
    revision: int | None,
    signed: bool,
    signed_only: bool,
    jurisdiction: str,
    template: str,
    page_size: str,
    allowed_jurisdictions: set[str],
    allowed_templates: set[str],
    allowed_page_sizes: set[str],
) -> dict:
    """Validate and persist a published document."""
    if not sanitized_html:
        raise ServiceError('html is required', 400)
    if signed_only and not signed:
        raise ServiceError('signed_only publish requires signed=true', 400)
    if revision is not None and revision < 1:
        raise ServiceError('revision must be >= 1 when provided', 400)
    if jurisdiction not in allowed_jurisdictions:
        raise ServiceError('invalid jurisdiction', 400)
    if template not in allowed_templates:
        raise ServiceError('invalid template', 400)
    if page_size not in allowed_page_sizes:
        raise ServiceError('invalid page_size', 400)

    expires_in_days = max(1, min(365, expires_in_days))
    publish_id = secrets.token_urlsafe(8)
    now = utc_now()
    expires_at = now + timedelta(days=expires_in_days)

    db.execute(
        '''INSERT INTO published_docs
           (id, title, html, created_at, expires_at, revision, signed, jurisdiction, template, page_size)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
        (
            publish_id,
            title,
            sanitized_html,
            now.isoformat(),
            expires_at.isoformat(),
            revision,
            1 if signed else 0,
            jurisdiction,
            template,
            page_size,
        ),
    )
    db.commit()

    return {
        'publish_id': publish_id,
        'expires_at': expires_at.isoformat(),
        'revision': revision,
        'signed': signed,
        'jurisdiction': jurisdiction,
        'template': template,
        'page_size': page_size,
    }


def get_published_for_email(*, db, publish_id: str) -> dict:
    """Load a published document and validate non-deleted/non-expired constraints."""
    row = db.execute(
        '''SELECT id, title, html, created_at, expires_at, deleted, revision, signed, jurisdiction, template, page_size
           FROM published_docs WHERE id = ?''',
        (publish_id,),
    ).fetchone()
    if not row or row['deleted']:
        raise ServiceError('Not found', 404)

    expires_at = datetime.fromisoformat(row['expires_at'])
    if expires_at < utc_now():
        raise ServiceError('Link expired', 410)
    return dict(row)


def get_public_published_document(*, db, publish_id: str) -> dict:
    """Load a published document for public rendering and increment views."""
    row = db.execute(
        '''SELECT id, title, html, created_at, expires_at, deleted
           FROM published_docs
           WHERE id = ?''',
        (publish_id,),
    ).fetchone()
    if not row or row['deleted']:
        raise ServiceError('Not found', 404)

    expires_at = datetime.fromisoformat(row['expires_at'])
    if expires_at < utc_now():
        raise ServiceError('Link expired', 410)

    db.execute('UPDATE published_docs SET views = views + 1 WHERE id = ?', (publish_id,))
    db.commit()
    return dict(row)


def get_published_metadata(*, db, publish_id: str) -> dict:
    """Load publish metadata by id."""
    row = db.execute(
        '''SELECT id, title, created_at, expires_at, deleted, views, revision, signed, jurisdiction, template, page_size
           FROM published_docs WHERE id = ?''',
        (publish_id,),
    ).fetchone()
    if not row:
        raise ServiceError('Not found', 404)
    return dict(row)


def delete_published_document(*, db, publish_id: str) -> None:
    """Soft-delete a published document by id."""
    cursor = db.execute(
        'UPDATE published_docs SET deleted = 1 WHERE id = ? AND deleted = 0',
        (publish_id,),
    )
    db.commit()
    if cursor.rowcount == 0:
        raise ServiceError('Not found', 404)


def cleanup_expired_published_documents(*, db) -> dict:
    """Soft-delete all expired, non-deleted published documents."""
    now = utc_now().isoformat()
    scanned = db.execute(
        'SELECT COUNT(*) FROM published_docs WHERE deleted = 0'
    ).fetchone()[0]
    cursor = db.execute(
        '''UPDATE published_docs
           SET deleted = 1
           WHERE deleted = 0 AND expires_at < ?''',
        (now,),
    )
    db.commit()
    return {
        'cleaned': cursor.rowcount,
        'scanned': scanned,
        'timestamp': now,
    }
