"""
Seed script: create the first superadmin account.

Usage:
    python scripts/seed_admin.py
"""

import asyncio
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.base import get_session_local
from app.models.admin import Admin


async def seed():
    session_local = get_session_local()
    async with session_local() as db:
        # Check if superadmin already exists
        from sqlalchemy import select
        result = await db.execute(
            select(Admin).where(Admin.email == "admin@example.com")
        )
        if result.scalar_one_or_none():
            print("Superadmin already exists. Skipping.")
            return

        admin = Admin(
            email="admin@example.com",
            password=Admin.get_password_hash("admin123!"),
            first_name="Super",
            last_name="Admin",
            role="superadmin",
            is_active=True,
        )
        db.add(admin)
        await db.commit()
        print("Superadmin created: admin@example.com / admin123!")


if __name__ == "__main__":
    asyncio.run(seed())
