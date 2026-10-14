import { createKeycloakAdminClient } from '../../../../test-tools/e2e/infrastructure.mjs';
import { type TestApp, createTestApp, shutdownTestApp } from '../setup-e2e.js';
import { randomUUID } from 'node:crypto';

const ADMIN_PASSWORD = 'e2e-admin-password';
const USER_PASSWORD = 'e2e-user-password';

interface GraphqlResult {
  status: number;
  body: {
    data?: Record<string, unknown>;
    errors?: Array<{ message: string }>;
  };
}

async function passwordGrant(
  username: string,
  password: string,
): Promise<string> {
  const realm = process.env.KC_REALM ?? 'omnixys';
  const res = await fetch(
    `${process.env.KC_URL}/realms/${realm}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: process.env.KC_CLIENT_ID ?? 'nexys',
        client_secret: process.env.KC_CLIENT_SECRET ?? '',
        username,
        password,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`password grant failed for ${username}: ${res.status}`);
  }
  const payload = (await res.json()) as { access_token: string };
  return payload.access_token;
}

describe('chat service e2e', () => {
  let testApp: TestApp;
  let userToken: string;

  async function graphql(
    query: string,
    headers: Record<string, string> = {},
    variables?: Record<string, unknown>,
  ): Promise<GraphqlResult> {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/graphql',
      headers: { 'content-type': 'application/json', ...headers },
      payload: { query, variables },
    });
    return { status: response.statusCode, body: response.json() };
  }

  beforeAll(async () => {
    testApp = await createTestApp();

    const admin = createKeycloakAdminClient(
      process.env.KC_URL as string,
      process.env.KC_REALM ?? 'omnixys',
    );
    await admin.resetUserPasswordForUsername('admin', ADMIN_PASSWORD);
    await admin.resetUserPasswordForUsername('user', USER_PASSWORD);

    userToken = await passwordGrant('user', USER_PASSWORD);
  }, 180000);

  afterAll(async () => {
    await shutdownTestApp(testApp);
  });

  it('reports liveness', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/health/liveness',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('reports readiness with the database, cache, kafka, realtime and gateway up', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/health/readiness',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('rejects anonymous GraphQL queries with an authentication error', async () => {
    const result = await graphql('{ conversations { id } }');
    expect(result.status).toBe(200);
    expect(result.body.errors).toBeDefined();
    expect(result.body.data?.conversations).toBeUndefined();
  });

  it('returns an empty conversation list for an authenticated tenant', async () => {
    const result = await graphql('{ conversations { id type unreadCount } }', {
      authorization: `Bearer ${userToken}`,
      'x-tenant-id': randomUUID(),
    });
    expect(result.status).toBe(200);
    expect(result.body.errors).toBeUndefined();
    expect(result.body.data?.conversations).toEqual([]);
  });

  it('creates an in-app conversation and reads it back', async () => {
    const tenant = randomUUID();
    const peer = randomUUID();
    const headers = {
      authorization: `Bearer ${userToken}`,
      'x-tenant-id': tenant,
      'content-type': 'application/json',
    };

    const createResult = await graphql(
      'mutation ($peer: String!) { createInAppConversation(participantUserId: $peer) { id type unreadCount participants { userId } } }',
      headers,
      { peer },
    );
    expect(createResult.body.errors).toBeUndefined();
    const created = createResult.body.data?.createInAppConversation as {
      id: string;
      type: string;
      unreadCount: number;
      participants: Array<{ userId: string }>;
    };
    expect(created.id).toBeTruthy();
    expect(created.type).toBe('DIRECT');
    expect(created.unreadCount).toBe(0);
    expect(created.participants.map((p) => p.userId)).toContain(peer);

    const listResult = await graphql('{ conversations { id type } }', {
      authorization: `Bearer ${userToken}`,
      'x-tenant-id': tenant,
      'content-type': 'application/json',
    });
    expect(listResult.body.errors).toBeUndefined();
    expect(listResult.body.data?.conversations).toEqual([
      { id: created.id, type: 'DIRECT' },
    ]);
  });

  it('refuses internal gateway endpoints without the shared key', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: `/api/v1/internal/conversations/${randomUUID()}/participants/${randomUUID()}`,
    });
    expect(res.statusCode).toBe(401);
  });
});
