"""SMTP email delivery for published SOW links."""
from __future__ import annotations

import os
import smtplib
from datetime import datetime
from email.message import EmailMessage
from html import escape


class EmailConfigError(RuntimeError):
    """Raised when required email configuration is missing/invalid."""


class EmailSendError(RuntimeError):
    """Raised when SMTP delivery fails."""


def _parse_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return default


def _required_missing(settings: dict, keys: tuple[str, ...]) -> list[str]:
    missing = []
    for key in keys:
        if not settings.get(key):
            missing.append(f'SMTP_{key.upper()}')
    return missing


def _validate_smtp_settings(settings: dict) -> None:
    missing = _required_missing(settings, ('host', 'from_email'))
    if missing:
        raise EmailConfigError(f"Missing SMTP configuration: {', '.join(missing)}")
    if settings["use_ssl"] and settings["use_starttls"]:
        raise EmailConfigError("SMTP_USE_SSL and SMTP_USE_STARTTLS cannot both be true")


def _load_smtp_settings() -> dict:
    settings = {
        "host": (os.environ.get("SMTP_HOST") or "").strip(),
        "port": int(os.environ.get("SMTP_PORT", "587")),
        "username": (os.environ.get("SMTP_USERNAME") or "").strip(),
        "password": (os.environ.get("SMTP_PASSWORD") or "").strip(),
        "from_email": (os.environ.get("SMTP_FROM_EMAIL") or "").strip(),
        "from_name": (os.environ.get("SMTP_FROM_NAME") or "SOW Creator").strip(),
        "use_starttls": _parse_bool(os.environ.get("SMTP_USE_STARTTLS"), True),
        "use_ssl": _parse_bool(os.environ.get("SMTP_USE_SSL"), False),
        "timeout_seconds": int(os.environ.get("SMTP_TIMEOUT_SECONDS", "10")),
    }
    _validate_smtp_settings(settings)
    return settings


def _build_message(
    *,
    to_email: str,
    subject: str,
    message: str,
    title: str,
    view_url: str,
    expires_at: str,
    signed: bool,
    from_display: str,
) -> EmailMessage:
    status_text = "Signed" if signed else "Unsigned Draft"
    intro = (message or "").strip()
    plain_parts = []
    if intro:
        plain_parts.append(intro)
    plain_parts.append(f"Document: {title}")
    plain_parts.append(f"Status: {status_text}")
    plain_parts.append(f"Link: {view_url}")
    plain_parts.append(f"Expires: {expires_at}")
    plain_body = "\n".join(plain_parts)

    html_intro = f"<p>{escape(intro)}</p>" if intro else ""
    html_body = (
        f"{html_intro}"
        f"<p><strong>Document:</strong> {escape(title)}</p>"
        f"<p><strong>Status:</strong> {escape(status_text)}</p>"
        f"<p><strong>Link:</strong> <a href=\"{escape(view_url)}\">{escape(view_url)}</a></p>"
        f"<p><strong>Expires:</strong> {escape(expires_at)}</p>"
    )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_display
    msg["To"] = to_email
    msg["Date"] = datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S +0000")
    msg.set_content(plain_body)
    msg.add_alternative(f"<html><body>{html_body}</body></html>", subtype="html")
    return msg


def _attach_pdf_if_requested(
    *,
    msg: EmailMessage,
    attach_pdf: bool,
    html_content: str,
    template_name: str,
    page_size: str,
    title: str,
) -> None:
    """Attach a rendered SOW PDF to message when requested."""
    if attach_pdf:
        try:
            from app.pdf_engine import generate_pdf

            pdf_bytes = generate_pdf(
                html_content,
                template_name=template_name,
                page_size=page_size,
            )
        except ModuleNotFoundError as exc:
            raise EmailConfigError("PDF export dependency not installed") from exc

        safe_name = title.replace(" ", "_") or "proposal"
        msg.add_attachment(
            pdf_bytes,
            maintype="application",
            subtype="pdf",
            filename=f"{safe_name}_SOW.pdf",
        )


def _send_message(*, settings: dict, msg: EmailMessage) -> None:
    """Send an email via configured SMTP transport."""
    if settings["use_ssl"]:
        server = smtplib.SMTP_SSL(
            settings["host"],
            settings["port"],
            timeout=settings["timeout_seconds"],
        )
    else:
        server = smtplib.SMTP(
            settings["host"],
            settings["port"],
            timeout=settings["timeout_seconds"],
        )

    try:
        with server:
            if settings["use_starttls"] and not settings["use_ssl"]:
                server.starttls()
            if settings["username"]:
                server.login(settings["username"], settings["password"])
            server.send_message(msg)
    except Exception as exc:  # pragma: no cover - mapped behavior is tested
        raise EmailSendError(f"Failed to send email: {exc}") from exc


def send_published_doc_email(
    *,
    to_email: str,
    subject: str,
    message: str,
    title: str,
    view_url: str,
    expires_at: str,
    signed: bool,
    attach_pdf: bool,
    html_content: str,
    template_name: str,
    page_size: str,
) -> dict:
    """Send a published SOW email through SMTP."""
    settings = _load_smtp_settings()
    from_display = f'{settings["from_name"]} <{settings["from_email"]}>'
    msg = _build_message(
        to_email=to_email,
        subject=subject,
        message=message,
        title=title,
        view_url=view_url,
        expires_at=expires_at,
        signed=signed,
        from_display=from_display,
    )
    _attach_pdf_if_requested(
        msg=msg,
        attach_pdf=attach_pdf,
        html_content=html_content,
        template_name=template_name,
        page_size=page_size,
        title=title,
    )
    _send_message(settings=settings, msg=msg)

    return {
        "to_email": to_email,
        "attached_pdf": bool(attach_pdf),
    }
