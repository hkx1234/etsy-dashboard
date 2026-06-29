from fastapi import FastAPI, Request, status, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.configs.docs_apps import create_client_app, create_backoffice_app
from fastapi.exceptions import RequestValidationError
from app.exceptions.http_exceptions import APIException
from app.schemas.response import ApiResponse
from contextlib import asynccontextmanager
from app.core.log_config import setup_logging, shutdown_logging, is_master_process
from app.services.common.redis import redis_client
from app.services.common.thread_pool import thread_pool_service
from app.db.base import close_db_engine
import logging
from app.common.log_consumer import consume_logs_forever
import threading
import asyncio

logger = logging.getLogger(__name__)

ALLOWED_ORIGINS = ["*"] if settings.ENV in ("development", "preview") else [
    "*"  # TODO: Replace with production domain
]


@asynccontextmanager
async def lifespan(application: FastAPI):
    # Startup
    setup_logging()
    logger.info("Application starting up")

    # Log consumer thread (master process only)
    if is_master_process():
        try:
            def run_log_consumer():
                asyncio.run(consume_logs_forever())

            log_thread = threading.Thread(target=run_log_consumer, daemon=True)
            log_thread.start()
            logger.info("[LogConsumer] Log consumer thread started (master process)")
        except Exception as e:
            logger.warning(f"[LogConsumer] Failed to start log consumer thread: {e}")

    yield  # Application running

    # Shutdown
    if is_master_process():
        shutdown_logging()
    await close_db_engine()
    await redis_client.close()
    thread_pool_service.shutdown()
    logger.info("Application shutting down")


def create_app():
    app = FastAPI(
        lifespan=lifespan,
        title=settings.PROJECT_NAME,
        description="FastAPI Template - Unified Entry",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Swagger navigation in dev
    if settings.ENV in ["development", "preview"]:
        @app.get("/", tags=["Docs Navigation"])
        async def swagger_navigation():
            return {
                "message": f"{settings.PROJECT_NAME} - Development Environment",
                "environment": settings.ENV,
                "documentation": {
                    "client_api": {
                        "swagger": "/client/docs",
                        "redoc": "/client/redoc",
                        "openapi": "/client/openapi.json",
                        "description": "Client API docs (no auth required)"
                    },
                    "backoffice_api": {
                        "swagger": "/backoffice/docs",
                        "redoc": "/backoffice/redoc",
                        "openapi": "/backoffice/openapi.json",
                        "description": "Backoffice API docs (JWT auth required)"
                    }
                },
                "api_exports": {
                    "client_json": "/api-docs/client.json",
                    "backoffice_json": "/api-docs/backoffice.json",
                    "info": "/api-docs/"
                },
                "health_check": "/api/v1/config/health"
            }

    # Register all routes via route registry
    from app.route.router_registry import register_routes, get_client_routes, get_backoffice_routes, get_common_routes

    register_routes(app, get_client_routes())
    register_routes(app, get_backoffice_routes())
    register_routes(app, get_common_routes())

    # Mount separate docs apps
    client_docs_app = create_client_app()
    backoffice_docs_app = create_backoffice_app()

    app.mount("/client", client_docs_app)
    app.mount("/backoffice", backoffice_docs_app)

    # Static file serving (avatars, etc.)
    from fastapi.staticfiles import StaticFiles
    import os
    os.makedirs("uploads/avatars", exist_ok=True)
    app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

    # Exception handlers
    @app.exception_handler(APIException)
    async def api_exception_handler(request: Request, exc: APIException):
        logger.error(f"API Exception: {exc.status_code} - {exc.code} - {exc.detail}",
                     extra={"request": f"{request.method} {request.url}"})
        return ApiResponse.failed(
            message=exc.detail,
            body_code=exc.code,
            http_code=exc.status_code,
            data=exc.data
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        logger.error(f"HTTP Exception: {exc.status_code} - {exc.detail}",
                     extra={"request": f"{request.method} {request.url}"})
        return ApiResponse.failed(
            message=exc.detail,
            body_code=exc.status_code,
            http_code=exc.status_code,
            data=None
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        logger.warning(f"Validation Error: {exc.errors()}",
                       extra={"request": f"{request.method} {request.url}"})
        return ApiResponse.failed(
            message="Validation error",
            body_code=1001,
            http_code=status.HTTP_400_BAD_REQUEST,
            data=exc.errors()
        )

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        logger.exception(f"Unhandled Exception: {str(exc)}",
                         extra={"request": f"{request.method} {request.url}"})
        return ApiResponse.failed(
            message="Internal server error",
            body_code=1005,
            http_code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )

    return app
