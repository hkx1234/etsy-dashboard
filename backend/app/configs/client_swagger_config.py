"""
Client-side Swagger UI Configuration
"""

from typing import Dict, Any
from app.core.config import settings

CLIENT_SWAGGER_UI_PARAMETERS = {
    "deepLinking": True,
    "displayRequestDuration": True,
    "docExpansion": "list",
    "operationsSorter": "alpha",
    "filter": True,
    "tryItOutEnabled": True,
}

CLIENT_OPENAPI_INFO = {
    "title": f"{settings.PROJECT_NAME} - Client API",
    "description": f"""
# Client API Service

Public API interface documentation for client applications.

## Functional Modules

### Authentication (Auth)
- User registration
- User login / logout
- JWT token management and refresh
- User profile retrieval

### Demo (Demo)
- Basic demonstration endpoints

### Configuration (Config)
- Health check
- Release configuration

## Authentication

⚠️ **Some endpoints require JWT authentication**

### Public Endpoints (No auth required):
- Registration
- Login
- Token refresh
- Configuration queries

### Protected Endpoints (Auth required):
- User profile (`/auth/me`)

### How to authenticate:
1. Call `/auth/login` to obtain an access token
2. Click the 🔒 **Authorize** button
3. Enter: `Bearer your-access-token`
4. Click **Authorize**

## Environment

- **Current Environment**: {settings.ENV}
- **API Version**: v1
    """,
    "version": "1.0.0",
    "contact": {
        "name": "Development Team",
        "email": settings.ADMIN_EMAIL,
    },
    "license_info": {
        "name": "MIT License",
        "url": "https://opensource.org/licenses/MIT",
    },
}

CLIENT_OPENAPI_TAGS = [
    {
        "name": "client-auth",
        "description": "Client authentication (register, login, profile)",
        "externalDocs": {
            "description": "Auth docs",
            "url": "https://fastapi.tiangolo.com/tutorial/security/",
        },
    },
    {
        "name": "client-demo",
        "description": "Demo endpoints",
    },
    {
        "name": "client-config",
        "description": "Configuration endpoints",
    },
]

CLIENT_SECURITY_SCHEMES = {
    "BearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "JWT token. Format: Bearer {token}. Obtain via the login endpoint.",
    }
}


def get_client_openapi_config() -> Dict[str, Any]:
    return {
        **CLIENT_OPENAPI_INFO,
        "openapi": "3.0.2",
        "tags": CLIENT_OPENAPI_TAGS,
        "components": {
            "securitySchemes": CLIENT_SECURITY_SCHEMES
        },
    }
