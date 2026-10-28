import { env } from './env.js';

/** Federation schema target shared by the application module and local tooling. */
export const chatSchemaFile =
  env.SCHEMA_TARGET === 'tmp'
    ? { path: '/tmp/chat-schema.gql', federation: 2 as const }
    : env.SCHEMA_TARGET === 'false'
      ? false
      : { path: 'dist/schema.gql', federation: 2 as const };
