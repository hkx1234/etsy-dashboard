from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.api.client.deps import get_current_user
from app.schemas.client.auth import (
    UserRegister, Login, AuthToken, AccessToken,
    RefreshTokenRequest, LogoutRequest
)
from app.schemas.client.auth import UserProfile
from app.services.client.auth import client_auth_service
from app.schemas.response import ApiResponse
from app.models.user import User

router = APIRouter()


@router.post("/register", response_model=AuthToken)
async def register(
    user_data: UserRegister,
    db: AsyncSession = Depends(get_db)
):
    """Register a new user"""
    result = await client_auth_service.register_user(
        db, user_data.model_dump()
    )
    return ApiResponse.success(data=result)


@router.post("/login", response_model=AuthToken)
async def login(
    login_data: Login,
    db: AsyncSession = Depends(get_db)
):
    """User login"""
    result = await client_auth_service.login(
        db, login_data.email, login_data.password, login_data.remember_me
    )
    return ApiResponse.success(data=result)


@router.post("/refresh", response_model=AccessToken)
async def refresh_token(
    request: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db)
):
    """Refresh access token"""
    result = await client_auth_service.refresh_token(db, request.refresh_token)
    return ApiResponse.success(data=result)


@router.post("/logout")
async def logout(
    request: LogoutRequest,
    db: AsyncSession = Depends(get_db)
):
    """User logout"""
    await client_auth_service.logout(db, request.refresh_token)
    return ApiResponse.success_without_data()


@router.get("/me", response_model=UserProfile)
async def get_current_user_info(
    current_user: User = Depends(get_current_user)
):
    """Get current user info"""
    return ApiResponse.success(data={
        "id": current_user.id,
        "email": current_user.email,
        "first_name": current_user.first_name,
        "last_name": current_user.last_name,
        "is_verified": current_user.is_verified,
    })
