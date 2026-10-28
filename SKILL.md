<!-- repository: services/chat | kind: SERVICE | stack: typescript -->

# chat - Skill: Service Development

> Workflow for chat (services/chat). Execute this workflow before, during, and
> after changes in this repository.

## Repository Facts

- Kind: Service
- Package: `chat-service` (Docker Hub image `omnixys/chat-service`)
- Runtime: Node >=26.8.1 <27, pnpm 11.24.0
- Description: Omnixys Chat Service - GraphQL HTTP plus `graphql-transport-ws` chat.
- Architecture: one `ChatModule` under `src/chat/` with `controllers`, `errors`,
  `models`, `persistence`, `ports`, `resolvers` and `services`; shared infrastructure remains under `src/adapter`,
  `src/analytics`, `src/config`, `src/health` and `src/prisma`. Tests live in
  `__tests__/unit` and `__tests__/contract`.
- Database: PostgreSQL via Prisma; Migrations: Prisma (`prisma/migrations/`)
- API: GraphQL on NestJS + Fastify, internal REST endpoints for the gateway
- Messaging: Kafka analytics events through a transactional outbox
- Tests: `node --test` with in-memory port doubles; no infrastructure required

## Workflow

### 1. Understand the change

- Identify whether the change belongs to the chat context or shared infrastructure.
- Inspect the consumers of the GraphQL operations, the internal endpoints, the
  Kafka topics and the Valkey channels you may touch. They are frozen contracts.
- Check `docs/PORTING-NOTES.md` before changing behaviour that the FastAPI
  implementation defined.
- Never weaken authentication or authorization to make a test pass.

### 2. Implement

- Keep the layer order of the architecture charter: controller/resolver thin,
  application service holds the logic, repository owns Prisma.
- Reuse `@omnixys/*-ts` packages before adding infrastructure of your own.
- Keep tenant isolation intact: resolvers check the verified context, pass user
  and tenant IDs explicitly to services, and every repository method takes
  `tenantId` as an argument. No query may omit the predicate.
- Raise domain failures through `src/chat/errors/chat.errors.ts` so every
  transport reports the same canonical `errorId`.

### 3. Write tests

- `__tests__/unit/` for application services, transports and security.
- `__tests__/contract/` for the generated GraphQL schema.
- Cover tenant isolation, membership checks and the error contract whenever the
  code path touches them.
- Reproduce a bug in a test before fixing it.

### 4. Validate

## Validation

Run each applicable check and record the result as `PASS`, `FAIL`, `PRE-EXISTING
FAILURE`, or `NOT RUN` (with a reason). Never convert `NOT RUN` into `PASS`.

- `pnpm install --frozen-lockfile`
- `pnpm run typecheck`
- `pnpm run lint:check`
- `pnpm run format:check`
- `pnpm test`
- `pnpm run prisma:validate`
- `pnpm run build`

## Commit

- Use Conventional Commits (`<type>(<scope>): <summary>`), e.g. `feat`, `fix`,
  `refactor`, `test`, `docs`, `build`, `ci`, `perf`.
- Stage only files belonging to the logical change. Run `git diff --check` before
  committing.
- Commit locally; never push.

## Definition of Done

See the "Definition of Done" section in `AGENTS.md`. Before finishing, confirm
`AGENTS.md` and `SKILL.md` remain accurate for this repository.

## Test workflow

Follow `docs/TESTING.md` for the separate unit command and migration-backed container integration requirements. Record executed test evidence and concrete scenarios in `docs/testing-methods.json`; candidate references alone do not establish coverage.

### Native TS-Unit-Prüfung

`pnpm run test:unit` baut zunächst frische `dist`-Artefakte und führt MJS-/TS-Unit-Tests sowie die vorhandene GraphQL-Vertragsschicht mit dem Node-Runner aus. `pnpm run test:typecheck` prüft Quellcode und neue TS-Unit-Dateien über `tsconfig.test.json`. TS-Tests laden `__tests__/unit/chat-fixtures.ts` vor Anwendungsmodulen; Entwickler-dotenv bleibt deaktiviert. Realtime-Abbruch mit kontrollierten Promises verifizieren und Listener zuverlässig schließen; Builds müssen vor Testläufen abgeschlossen sein. Prisma-Schemavalidierung braucht auch einen kontrollierten `SHADOW_DATABASE_URL`-Wert; ausschließlich Containerintegration darf Migrationen ausführen.

## Release integration

The existing TypeScript migration is retained. service-ci.yml validates Node/Prisma; release-control owns versioning and Docker Hub publication. The startup Prisma CLI is a production dependency. No production migration or deployment is performed by preparing/publishing the image. Additional local tests were NOT RUN at the user's explicit request; normal Forgejo CI remains required.
