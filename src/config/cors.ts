/**
 * @license GPL-3.0-or-later
 * Copyright (C) 2025 Caleb Gyamfi - Omnixys Technologies
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * For more information, visit <https://www.gnu.org/licenses/>.
 */

import type { FastifyCorsOptions } from '@fastify/cors';

/**
 * @file cors.ts
 * @description CORS-(Cross-Origin Resource Sharing)-Konfiguration
 * für den Omnixys-Backend-Service.
 *
 * Diese Datei definiert, welche Ursprünge (Domains), HTTP-Methoden und
 * Header von anderen Anwendungen (z. B. Frontends) akzeptiert werden.
 *
 * Sie ist erforderlich, wenn Frontend und Backend auf **unterschiedlichen
 * Domains oder Ports** laufen (z. B. Next.js auf Port 3000, API auf 4000).
 *
 * @remarks
 * - Wird global in {@link main.ts} über
 *   `app.register(cors, corsOptions)` eingebunden.
 * - Sollte für Produktionsumgebungen **nicht mit `*`** arbeiten,
 *   sondern auf bekannte Ursprünge eingeschränkt werden.
 * - Typischerweise erlaubt für:
 *   - `http://localhost:3000` → lokale Next.js-Entwicklung
 *   - `https://studio.apollographql.com` → GraphQL Playground / Apollo Studio
 *
 * @see https://developer.mozilla.org/docs/Web/HTTP/CORS
 * @see https://fastify.dev/docs/latest/Reference/CORS/
 */
export const corsOptions: FastifyCorsOptions = {
  // ======================================================
  // 🌐 Ursprünge (Origins)
  // ======================================================

  /**
   * Erlaubte Ursprünge (Domains), die Anfragen an dieses Backend senden dürfen.
   *
   * @remarks
   * - Enthält lokale Entwicklungs-Frontends und ggf. Tools wie Apollo Studio.
   */
  origin: [
    'http://localhost:3000', // lokales Next.js-Frontend
    'https://studio.apollographql.com', // GraphQL Playground / Apollo Studio
  ],

  // ======================================================
  // ⚙️ HTTP-Methoden
  // ======================================================

  /**
   * Erlaubte HTTP-Methoden für CORS-Anfragen.
   *
   * @remarks
   * Umfasst alle gängigen REST- und GraphQL-Operationen.
   */
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],

  // ======================================================
  // 🔑 Authentifizierung / Credentials
  // ======================================================

  /**
   * Ob Anfragen mit Anmeldeinformationen (z. B. Cookies, Tokens, Authorization-Header)
   * zugelassen sind.
   *
   * @default true
   * @remarks
   * Muss `true` sein, wenn das Frontend JWT- oder Keycloak-Tokens sendet.
   */
  credentials: true,

  // ======================================================
  // 📨 Request-Header
  // ======================================================

  /**
   * Vom Client erlaubte Request-Header.
   *
   * @remarks
   * Beinhaltet Standard-Header wie `Content-Type` und `Authorization`,
   * sowie optionale Conditional-Header (`If-Match`, `If-None-Match`).
   */
  allowedHeaders: [
    'Origin',
    'Accept',
    'Content-Type',
    'Authorization',
    'Allow',
    'Content-Length',
    'Date',
    'If-Match',
    'If-None-Match',
    'sec-fetch-mode',
    'sec-fetch-site',
    'sec-fetch-dest',
  ],

  // ======================================================
  // 📤 Response-Header
  // ======================================================

  /**
   * Vom Client einsehbare Response-Header.
   *
   * @remarks
   * Dient dazu, sicherheits- und cache-relevante Header explizit
   * freizugeben (z. B. CSP, HSTS, ETag).
   */
  exposedHeaders: [
    'Content-Type',
    'Content-Length',
    'ETag',
    'Location',
    'Date',
    'Last-Modified',
    'Access-Control-Allow-Origin',
    'Content-Security-Policy',
    'Strict-Transport-Security',
    'X-Content-Type-Options',
  ],

  // ======================================================
  // ⏱ Cache-Dauer
  // ======================================================

  /**
   * Zeit (in Sekunden), wie lange Preflight-Anfragen (`OPTIONS`)
   * im Browser zwischengespeichert werden dürfen.
   *
   * @default 86400 (= 24 Stunden)
   */
  maxAge: 86_400,
};
