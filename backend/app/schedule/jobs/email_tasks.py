"""
Email task stubs - customise for your project.

This module demonstrates the Celery task pattern.
Replace the stub implementations with real email sending logic.
"""

from celery import shared_task
import logging

logger = logging.getLogger(__name__)


@shared_task(name="send_welcome_email", queue="scheduled_tasks")
def send_welcome_email_task(email: str, first_name: str = None):
    """Send welcome email to newly registered user (stub)"""
    logger.info(f"[EMAIL STUB] Would send welcome email to {email} (name: {first_name})")
    # TODO: Integrate your email service here:
    # from app.services.common.email import email_service
    # email_service.send_email(...)
    return f"Welcome email stub sent to {email}"
