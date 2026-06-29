from typing import Optional, Dict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from datetime import datetime, timedelta, UTC
from app.models.user import User
from app.models.token import Token
from app.core.security import AuthBase
from app.core.config import settings
from app.db.session import transaction
from app.exceptions.http_exceptions import APIException
import re


class ClientAuthService(AuthBase):
    @staticmethod
    def validate_password(password: str) -> bool:
        """Validate password strength"""
        if len(password) < 8:
            raise APIException(status_code=400, message="Password must be at least 8 characters")
        if not re.search(r'[A-Za-z]', password):
            raise APIException(status_code=400, message="Password must contain at least one letter")
        if not re.search(r'\d', password):
            raise APIException(status_code=400, message="Password must contain at least one number")
        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
            raise APIException(status_code=400, message="Password must contain at least one special character")
        return True

    @staticmethod
    async def authenticate_user(db: AsyncSession, email: str, password: str) -> Optional[User]:
        """Authenticate user by email and password"""
        user_query = select(User).where(User.email == email)
        result = await db.execute(user_query)
        user = result.scalar_one_or_none()
        if not user or not user.verify_password(password):
            return None
        return user

    @staticmethod
    async def register_user(db: AsyncSession, user_data: Dict) -> Dict:
        """Register a new user"""
        async with transaction(db):
            existing_user = await db.execute(
                select(User).where(User.email == user_data["email"])
            )
            if existing_user.scalar_one_or_none():
                raise APIException(status_code=400, message="Email already registered")

            ClientAuthService.validate_password(user_data["password"])

            user = User(
                email=user_data["email"],
                hashed_password=User.get_password_hash(user_data["password"]),
                first_name=user_data.get("first_name"),
                last_name=user_data.get("last_name"),
                is_active=True,
                is_verified=True,  # Auto-verify in this simplified template
            )
            db.add(user)
            await db.flush()

            # Generate tokens
            access_token = AuthBase.create_access_token(
                str(user.id),
                scope="client",
                expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
            )
            refresh_token = AuthBase.create_refresh_token(str(user.id))

            hashed_token = AuthBase.hash_token(refresh_token)
            token = Token(
                user_id=user.id,
                token=hashed_token,
                expires_at=datetime.now(UTC) + timedelta(days=7),
                is_active=True
            )
            db.add(token)

            return {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "token_type": "bearer",
                "user": {
                    "id": user.id,
                    "email": user.email,
                    "first_name": user.first_name,
                    "last_name": user.last_name,
                    "is_verified": user.is_verified,
                }
            }

    @staticmethod
    async def login(db: AsyncSession, email: str, password: str, remember_me: bool = False) -> Dict:
        """User login"""
        async with transaction(db):
            user = await ClientAuthService.authenticate_user(db, email, password)
            if not user:
                raise APIException(status_code=400, message="Invalid email or password")
            if not user.is_active:
                raise APIException(status_code=400, message="Account is disabled")

            # Deactivate old tokens
            await db.execute(
                update(Token).where(
                    (Token.user_id == user.id) &
                    (Token.is_active == True)
                ).values(is_active=False)
            )

            access_token = AuthBase.create_access_token(
                str(user.id),
                scope="client",
                expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
            )

            refresh_expires = timedelta(days=30 if remember_me else 7)
            refresh_token = AuthBase.create_refresh_token(
                str(user.id),
                expires_delta=refresh_expires
            )

            hashed_token = AuthBase.hash_token(refresh_token)
            token = Token(
                user_id=user.id,
                token=hashed_token,
                expires_at=datetime.now(UTC) + refresh_expires,
                is_active=True
            )
            db.add(token)

            user.last_active_at = datetime.now(UTC)

            return {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "token_type": "bearer",
                "user": {
                    "id": user.id,
                    "email": user.email,
                    "first_name": user.first_name,
                    "last_name": user.last_name,
                    "is_verified": user.is_verified,
                }
            }

    @staticmethod
    async def refresh_token(db: AsyncSession, refresh_token: str) -> Dict:
        """Refresh user token"""
        payload = AuthBase.verify_token(refresh_token, scope="refresh")
        if not payload:
            raise APIException(status_code=401, message="Invalid refresh token")

        user_id = payload.get("sub")
        token_query = select(Token).where(
            (Token.user_id == user_id) &
            (Token.is_active == True)
        )
        result = await db.execute(token_query)
        token = result.scalar_one_or_none()

        if not token or not AuthBase.verify_token_hash(refresh_token, token.token):
            raise APIException(status_code=401, message="Invalid or expired refresh token")

        user = await db.execute(select(User).where(User.id == user_id))
        user = user.scalar_one_or_none()

        if not user or not user.is_active:
            raise APIException(status_code=401, message="User account is not active")

        token.last_used_at = datetime.now(UTC)
        await db.commit()

        access_token = AuthBase.create_access_token(
            user_id,
            scope="client",
            expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        )

        return {
            "access_token": access_token,
            "token_type": "bearer"
        }

    @staticmethod
    async def logout(db: AsyncSession, refresh_token: str) -> None:
        """User logout"""
        payload = AuthBase.verify_token(refresh_token, scope="refresh")
        if not payload:
            return

        user_id = payload.get("sub")
        token_query = select(Token).where(
            (Token.user_id == user_id) &
            (Token.is_active == True)
        )
        result = await db.execute(token_query)
        token = result.scalar_one_or_none()

        if token and AuthBase.verify_token_hash(refresh_token, token.token):
            token.is_active = False
            await db.commit()


client_auth_service = ClientAuthService()
