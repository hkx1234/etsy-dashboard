from typing import Optional
from pydantic import EmailStr, field_validator
from ..base import BaseSchema
import re


class UserRegister(BaseSchema):
    first_name: str
    last_name: str
    email: EmailStr
    password: str

    @field_validator('password')
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError('Password must be at least 8 characters')
        if not re.search(r'[A-Za-z]', v):
            raise ValueError('Password must contain at least one letter')
        if not re.search(r'\d', v):
            raise ValueError('Password must contain at least one number')
        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', v):
            raise ValueError('Password must contain at least one special character')
        return v


class Login(BaseSchema):
    email: EmailStr
    password: str
    remember_me: bool = False


class UserProfile(BaseSchema):
    id: int
    email: str
    first_name: Optional[str]
    last_name: Optional[str]
    is_verified: bool


class AuthToken(BaseSchema):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserProfile


class AccessToken(BaseSchema):
    access_token: str
    token_type: str = "bearer"


class RefreshTokenRequest(BaseSchema):
    refresh_token: str


class LogoutRequest(BaseSchema):
    refresh_token: str
