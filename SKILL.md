<!-- repository: services/chat | kind: SERVICE | stack: python -->

# chat — Skill: Service Development

> Workflow for chat (services/chat). Execute this workflow before, during, and
> after changes in this repository.

## Repository Facts

- Kind: Service
- Package: `chat` (version: 1.2.2)
- Runtime: Python >=3.14 (uv)
- Description: Omnixys Chat Service – FastAPI + Strawberry GraphQL chat.
- Architecture: src/chat/{api, application, domain, infrastructure} DDD layout; tests under tests/ (unit, integration, repository, security, contract, graphql)
- Database: PostgreSQL via SQLAlchemy 2 async + asyncpg; Migrations: Alembic (migrations/)
- API: GraphQL (Strawberry) on FastAPI
- Messaging: Kafka via omnixys-kafka
- Tests: pytest with pytest-asyncio (asyncio_mode=auto); tests/ directory


## Workflow

### 1. Understand the change

- Identify the affected bounded context within `src/chat/{api, application, domain, infrastructure} DDD layout; tests under tests/ (unit, integration, repository, security, contract, graphql)`.
- Inspect consumers of the GraphQL operations and Kafka events you may touch.
- Never weaken authentication or authorization to make a test pass.

### 2. Implement

- Follow the existing module layout and naming conventions.
- Reuse `omnixys/packages` (shared contracts, cache, kafka, observability, security, ...)
  before reimplementing shared infrastructure.
- Keep tenant isolation intact (`DDD (domain/application/infrastructure/api). Ruff select=ALL, mypy strict, SQLAlchemy mypy plugin.`).

### 3. Write tests

- Unit tests exercise isolated business behavior.
- Integration tests cover repository/Prisma, GraphQL, Kafka, and auth boundaries.
- Cover tenant-isolation and error-contract cases when the code path touches them.

### 4. Validate

## Validation

Run each applicable check and record the result as `PASS`, `FAIL`, `PRE-EXISTING
FAILURE`, or `NOT RUN` (with a reason). Never convert `NOT RUN` into `PASS`.

  - `uv sync --frozen`
  - `uv run ruff format --check src/ (ruff formatting configured)`
  - `uv run ruff check src/`
  - `uv run mypy src/`
  - `uv run pytest tests/unit`
  - `uv run pytest tests/integration`
  - `uv build (hatchling)`
  - `uv run pytest --tb=short -q`

## Commit

- Use Conventional Commits (`<type>(<scope>): <summary>`), e.g. `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `ci`, `perf`.
- Stage only files belonging to the logical change. Run `git diff --check` before committing.
- Commit locally; never push.

## Definition of Done

See the "Definition of Done" section in `AGENTS.md`. Before finishing, confirm
`AGENTS.md` and `SKILL.md` remain accurate for this repository.
