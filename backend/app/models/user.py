from sqlalchemy import Boolean, Column, Integer, String, TIMESTAMP
from sqlalchemy.sql import func
from .base import BaseModel
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class User(BaseModel):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    email = Column(String(255), unique=True, index=True)
    hashed_password = Column(String(255))
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    avatar = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=False)
    is_verified = Column(Boolean, default=False)
    email_verified_at = Column(TIMESTAMP(timezone=True), nullable=True)
    last_active_at = Column(TIMESTAMP(timezone=True), nullable=True, default=func.now())

    @staticmethod
    def get_password_hash(password: str) -> str:
        return pwd_context.hash(password)

    def verify_password(self, plain_password: str) -> bool:
        return pwd_context.verify(plain_password, self.hashed_password)
