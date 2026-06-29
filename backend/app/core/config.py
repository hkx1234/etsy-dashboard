from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")
    # Environment
    ENV: str = "development"

    # Basic
    PROJECT_NAME: str = "FastAPI Template"
    API_V1_STR: str = "/api/v1"
    API_PORT: int = 8001
    FRONTEND_URL: str = "http://localhost:3000"

    # Docker ports (for docker-compose)
    REDIS_EXTERNAL_PORT: int = 6386
    NGINX_HTTP_PORT: int = 8086
    NGINX_HTTPS_PORT: int = 8446
    FLOWER_PORT: int = 5556

    # Database
    POSTGRES_USER: str = "demo"
    POSTGRES_PASSWORD: str = "demo123"
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "demo"

    # Redis
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: str = ""

    # Celery
    CELERY_BROKER_URL: str = ""
    CELERY_RESULT_BACKEND: str = ""

    # HTTP proxy (dev only)
    USE_HTTP_PROXY: bool = False
    HTTP_PROXY: str = "http://127.0.0.1:7890"
    HTTPS_PROXY: str = "http://127.0.0.1:7890"

    # Email
    MAIL_MAILER: str = "smtp"
    MAIL_HOST: str = "localhost"
    MAIL_PORT: int = 1025
    MAIL_USERNAME: str = "user"
    MAIL_PASSWORD: str = "password"
    MAIL_FROM_ADDRESS: str = "noreply@example.com"
    MAIL_FROM_NAME: str = "App"
    MAIL_ENCRYPTION: str = "none"

    # Brevo
    BREVO_API_KEY: str = "dummy-api-key"
    BREVO_EMAIL_FROM: str = "noreply@example.com"
    BREVO_EMAIL_FROM_NAME: str = "App"

    # Admin email
    ADMIN_EMAIL: str = "admin@example.com"

    # JWT
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # S3 / File Storage
    AWS_ACCESS_KEY_ID: str = "your-access-key"
    AWS_SECRET_ACCESS_KEY: str = "your-secret-key"
    AWS_REGION: str = "us-east-1"
    AWS_BUCKET_NAME: str = "your-bucket-name"
    AWS_ENDPOINT: str = "https://s3.amazonaws.com"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if self.REDIS_PASSWORD:
            redis_url = (
                f"redis://:{self.REDIS_PASSWORD}@{self.REDIS_HOST}:{self.REDIS_PORT}/0"
            )
        else:
            redis_url = f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/0"
        self.CELERY_BROKER_URL = redis_url
        self.CELERY_RESULT_BACKEND = redis_url


settings = Settings()
