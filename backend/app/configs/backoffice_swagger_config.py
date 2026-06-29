"""
Backoffice Swagger UI Configuration
"""

from typing import Dict, Any
from app.core.config import settings

BACKOFFICE_SWAGGER_UI_PARAMETERS = {
    "deepLinking": True,
    "displayRequestDuration": True,
    "docExpansion": "list",
    "operationsSorter": "alpha",
    "filter": True,
    "tryItOutEnabled": True,
}

BACKOFFICE_OPENAPI_INFO = {
    "title": f"{settings.PROJECT_NAME} - Backoffice API",
    "description": f"""
# Backoffice Management API

Internal API interface documentation for the backoffice management system.

## Functional Modules

### Authentication (Auth)
- Administrator login / logout
- JWT token management
- Token refresh

### Administrator Management (Admin)
- Admin account CRUD operations
- Role-based permission management
- Password management

## Authentication

⚠️ **All backoffice endpoints require JWT authentication** (except login)

### How to authenticate:
1. Call `/login` to obtain an access token
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

BACKOFFICE_OPENAPI_TAGS = [
    {
        "name": "backoffice-auth",
        "description": "Backoffice authentication",
        "externalDocs": {
            "description": "Auth docs",
            "url": "https://fastapi.tiangolo.com/tutorial/security/",
        },
    },
    {
        "name": "backoffice-admin",
        "description": "Administrator management (CRUD)",
        "externalDocs": {
            "description": "Admin docs",
            "url": "https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/",
        },
    },
]

BACKOFFICE_SECURITY_SCHEMES = {
    "BearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "JWT token. Format: Bearer {token}. Obtain via the login endpoint.",
    }
}


def get_backoffice_openapi_config() -> Dict[str, Any]:
    return {
        **BACKOFFICE_OPENAPI_INFO,
        "openapi": "3.0.2",
        "tags": BACKOFFICE_OPENAPI_TAGS,
        "components": {
            "securitySchemes": BACKOFFICE_SECURITY_SCHEMES
        },
    }
