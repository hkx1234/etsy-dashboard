# Fullstack Template

A production-ready full-stack monorepo scaffold featuring **FastAPI** (Python) backend and
**Vue 3** (JavaScript) frontends for both client and admin applications.

## Architecture Overview

```
fullstack-template/
├── backend/          # Python FastAPI backend
│   ├── app/
│   │   ├── api/          # Route handlers (client/v1 + backoffice/v1)
│   │   ├── common/       # Shared utilities (i18n, log consumer, release)
│   │   ├── configs/      # Swagger configs, docs app factories
│   │   ├── core/         # Settings, security (JWT), logging, Celery
│   │   ├── db/           # SQLAlchemy async engine, session, declarative Base
│   │   ├── exceptions/   # Custom exception hierarchy
│   │   ├── models/       # SQLAlchemy ORM models
│   │   ├── route/        # App factory + centralized route registration
│   │   ├── schedule/     # Celery jobs + APScheduler
│   │   ├── schemas/      # Pydantic request/response models
│   │   ├── services/     # Business logic (client / backoffice / common)
│   │   └── utils/        # S3 handler, HTML sanitizer, proxy config
│   ├── migrations/       # Alembic (async)
│   ├── nginx/            # Reverse proxy config
│   ├── scripts/          # Seed scripts, deploy
│   └── docker-compose.yml
├── frontend/         # Vue 3 client SPA
│   └── src/
│       ├── api/          # Axios instance + API modules
│       ├── router/       # Vue Router with auth guards
│       ├── stores/       # Pinia auth store
│       └── views/        # Page components
└── admin/            # Vue 3 admin SPA (same structure)
```

## Key Design Patterns

### Backend

| Pattern | Description |
|---------|-------------|
| **Centralized Route Registration** | Routes are defined as `RouteConfig` data classes in `router_registry.py` and dynamically imported via `__import__`. Add new routes by appending to `CLIENT_ROUTES`, `BACKOFFICE_ROUTES`, or `COMMON_ROUTES`. |
| **Dual API Docs** | Client and backoffice APIs have separate Swagger docs mounted at `/client` and `/backoffice`. Each has its own OpenAPI schema with JWT security configuration. |
| **Standardized Response Format** | All responses use `ApiResponse` (success/failed/paginate) with `{code, message, data}`. |
| **JWT Auth with Scope** | `AuthBase` class creates tokens with scope (`client` / `backoffice` / `refresh`). Dependency injection extracts current user/admin. |
| **Async SQLAlchemy** | Lazy engine initialization for Alembic compatibility. DI via `get_db` generator. `transaction` context manager for auto commit/rollback. |
| **Custom Exception Hierarchy** | `APIException` → `ValidationError`, `AuthenticationError`, `AuthorizationError`, `NotFoundError`, `ServerError`. Caught by global exception handlers. |
| **Pydantic Settings** | `BaseSettings` with `.env` file, validated at startup. |
| **Laravel-style Paginator** | `Paginator` class with chainable `.map()` and `.response()`. |

### Frontend & Admin

| Pattern | Description |
|---------|-------------|
| **Axios Interceptors** | Request interceptor auto-attaches Bearer token. Response interceptor handles 401/403 with redirect to login and unified error parsing. |
| **Pinia Auth Store** | Token-based auth with localStorage persistence. `setAuth`, `setUserInfo`, `logout` actions. |
| **Vue Router Auth Guard** | `beforeEach` checks `meta.auth` and redirects unauthenticated users to `/login`. |
| **Lazy-loaded Views** | All page components use dynamic `import()` for code splitting. |

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Backend framework | FastAPI (Python 3.11+) |
| Database | PostgreSQL 16 + pgvector |
| ORM | SQLAlchemy 2.0 (async) |
| Migrations | Alembic |
| Cache / Queue | Redis 7 |
| Task Queue | Celery 5 + Celery Beat |
| Auth | JWT (python-jose) + bcrypt (passlib) |
| Email | SMTP / Brevo API |
| File Storage | AWS S3 (boto3) |
| Reverse Proxy | Nginx |
| Frontend | Vue 3 + Vite |
| State Management | Pinia |
| Routing | Vue Router 4 |
| HTTP Client | Axios |
| Containerization | Docker + Docker Compose |

## Quick Start

### 1. Backend

```bash
cd backend

# Copy and configure environment
cp .env.example .env
# Edit .env with your database credentials and secrets

# Install dependencies
pip install -r requirements.txt

# Run migrations
alembic upgrade head

# Seed the first admin
python scripts/seed_admin.py

# Start dev server
python main.py
# or: uvicorn main:app --reload --port 8001
```

Swagger docs:
- Client API: http://localhost:8001/client/docs
- Backoffice API: http://localhost:8001/backoffice/docs

### 2. Frontend

```bash
cd frontend
npm install
npm run dev        # → http://localhost:3000
```

### 3. Admin Panel

```bash
cd admin
npm install
npm run dev        # → http://localhost:3001
```

### Docker (all services)

```bash
cd backend
docker-compose up -d
# Starts: app, celery-worker, celery-beat, postgres, redis, nginx
# Optionally: docker-compose --profile monitoring up -d  (adds Flower)
```

## How to Customize

1. **Rename the project**: Update `PROJECT_NAME` in `backend/.env` and titles in
   `frontend/index.html` / `admin/index.html`
2. **Add a new API module**:
   - Create model in `app/models/`
   - Create schema in `app/schemas/client/` or `backoffice/`
   - Create service in `app/services/`
   - Create route handler in `app/api/.../v1/`
   - Add route config to `app/route/router_registry.py`
   - Run `alembic revision --autogenerate -m "description"` and `alembic upgrade head`
3. **Add a new frontend page**:
   - Create view in `src/views/`
   - Add route in `src/router/index.js`
   - Add API functions in `src/api/`
4. **Add a background job**:
   - Create task in `app/schedule/jobs/`
   - Register in `app/core/celery_app.py`

## License

MIT
