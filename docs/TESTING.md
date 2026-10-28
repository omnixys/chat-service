# Tests: chat

Die Unit- und Integrationsschicht haben getrennte Nachweise. Eine grüne Unit-Suite ersetzt keinen Test mit echter Datenbank.

## Unit-Tests

Runner: Node test runner.

```sh
DOTENV_CONFIG_PATH=/dev/null NODE_ENV=test node --experimental-test-module-mocks --test __tests__/unit/*.test.mjs __tests__/unit/*.test.ts __tests__/contract/*.test.mjs
```

Aktueller Nachweis vom 2026-10-13: **PASS**, 377 Tests, darunter 280 neue Unit-Tests und die unveränderte vorhandene GraphQL-Vertragsschicht. Datenbankintegration ist darin nicht enthalten.

Die [Methodenmatrix](testing-methods.json) enthält 57 enumerierte Methoden. Alle 57 haben manuell beschriebene Szenarien und erfolgreiche Unit-Nachweise. Die Rate-Limit-Adapter (`ValkeyRateLimitStore.incr/ttl/expire`) sind über `__tests__/unit/rate-limit-store.test.mjs` abgedeckt. Kandidatenverweise und `@covers` allein zählen nicht als geprüfte Abdeckung.

## Integration

**ZURÜCKGESTELLT** auf Nutzeranweisung: nur Unit-Tests in dieser Phase; keine serviceinterne oder serviceübergreifende Integration, keine Container-Nutzung und keine Datenbankänderungen. Historische Integrationsnachweise werden nicht als Unit-Abschlusskriterium verwendet. Die folgenden Infrastrukturhinweise betreffen ausschließlich eine spätere Phase.

Container-Verbindungsdaten müssen vor dem Laden von Anwendung und Prisma-Konfiguration gesetzt werden. Vorhandene Prisma-Produktionsmigrationen sind zu verwenden; das PostgreSQL-Image muss gegebenenfalls `uuidv7()` unterstützen.

## End-to-End (E2E)

Runner: Vitest + Testcontainers. Die Suite bootet das kompilierte Artefakt
`dist/app.module.js` über HTTP/GraphQL und startet echte Container
(PostgreSQL 18, Valkey 9, Redpanda v24.1.6, Keycloak 26.4 mit
`__tests__/keycloak/omnixys-realm.json`). Zusätzlich läuft ein kleiner
HTTP-Doppel für den Gateway-Client, da die Readiness diesen Port prüft.

```sh
pnpm run test:e2e
pnpm run test:e2e:debug   # ohne Dateiparallelität
```

Aktueller Nachweis vom 2026-10-13: **PASS**, 6 Tests (Liveness, Readiness,
anonyme GraphQL-Abfrage wird abgewiesen, leere Konversationsliste für einen
verifizierten Mandanten, Anlegen und Zurücklesen einer In-App-Konversation,
interne Gateway-Route ohne geteilten Schlüssel -> 401).

Die E2E-Schicht zählt **nicht** als Integrationsnachweis, trägt kein `@covers`
und lässt `docs/testing-methods.json` inhaltlich unverändert. Die Prisma-Migration
`20260101000100_add_chat_tenant_scope` benötigt die Session-Variable
`chat.default_tenant_id`; sie wird ausschließlich für den Migrationsprozess über
den Connection-String gesetzt (siehe `__tests__/e2e/setup-e2e.ts`).

## Build und statische Prüfungen

```sh
pnpm run build
pnpm run test:typecheck
pnpm run format:check
pnpm run lint
```

Lint und Formatprüfung erfassen auch neue Testdateien. Build, vollständige Quell-/neue TS-Test-Typprüfung, vollständiges Lint ohne automatische Korrekturen (0 Fehler/0 Warnungen) und vollständige Formatprüfung bestehen. Prisma-Schemavalidierung besteht mit kontrollierten DATABASE_URL und SHADOW_DATABASE_URL. Zwei ungenutzte Bindungen in einer alten Unit-Datei wurden ohne Änderungen an Testfällen oder Assertions bereinigt. Die Typprüfung neuer MJS-Tests ist noch nicht durchgängig eingerichtet.

## Arbeitsablauf

Vom Ordner `services` aus:

```sh
node test-tools/method-inventory.mjs --write
node test-tools/method-inventory.mjs --strict
```

Der strikte Audit darf bei fehlenden Nachweisen nicht als erfolgreich gewertet werden. Nach Änderungen an Quelle oder referenziertem Test wird die geprüfte Zuordnung wegen geändertem Hash ungültig. Checkpoint-Vertragstests bleiben eine eigene, unveränderte Testschicht.

## Realtime-Regression

Der neue erste Listener-Test schlug vor dem Fix fehl (0 statt 1 Valkey-Registrierungen). `ValkeyRealtimePublisher` verwechselt jetzt den lokalen Observer nicht mehr mit einer bereits vorhandenen Backend-Registrierung. Eine Registrierung wird je lokalem Stream geteilt; Abbau wartet auf laufende Registrierung, Ersatzlistener warten auf vorherigen Abbau, und Shutdown wartet auf alle Freigaben. Elf Listener-Tests und die vollständige Suite bestehen. Für einen echten Valkey-/WebSocket-Nachweis ist die Integrationsschicht noch erforderlich. Neue TS-Tests werden statisch geprüft; MJS-Typprüfung bleibt eine separate Lücke.
