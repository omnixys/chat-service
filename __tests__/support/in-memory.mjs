import { Subject } from 'rxjs';

/**
 * In-memory doubles for the chat ports.
 *
 * The unit tests run against these instead of Prisma, so they exercise the
 * application services, the tenant predicates and the invariants without a
 * database. Every store keeps `tenantId` on the row and every lookup takes it as
 * an argument, exactly like the real adapter.
 */

export class UniqueViolationError extends Error {
  constructor(message = 'Unique constraint failed') {
    super(message);
    this.name = 'PrismaClientKnownRequestError';
    this.code = 'P2002';
  }
}

export function createInMemoryRepositories() {
  const conversations = [];
  const messages = [];
  const readStates = [];
  const facts = [];
  let sequence = 0;
  const nextId = (prefix) => `${prefix}-${++sequence}`;

  const conversationRepository = {
    async findById(tenantId, conversationId) {
      const found = conversations.find(
        (row) => row.id === conversationId && row.tenantId === tenantId,
      );
      return found === undefined ? null : structuredClone(found);
    },
    async findByIdAnyTenant(conversationId) {
      const found = conversations.find((row) => row.id === conversationId);
      return found === undefined ? null : structuredClone(found);
    },
    async findByParticipantPairKey(tenantId, key) {
      const found = conversations.find(
        (row) => row.tenantId === tenantId && row.participantPairKey === key,
      );
      return found === undefined ? null : structuredClone(found);
    },
    async findByExternalAddress(tenantId, address) {
      const found = conversations.find(
        (row) => row.tenantId === tenantId && row.externalAddress === address,
      );
      return found === undefined ? null : structuredClone(found);
    },
    async findByExternalAddressAnyTenant(address) {
      return conversations
        .filter((row) => row.externalAddress === address)
        .map((row) => structuredClone(row));
    },
    async findByUserId(tenantId, userId) {
      return conversations
        .filter(
          (row) =>
            row.tenantId === tenantId && row.participantIds.includes(userId),
        )
        .map((row) => structuredClone(row));
    },
    async isParticipant(tenantId, conversationId, userId) {
      const found = conversations.find(
        (row) =>
          row.id === conversationId &&
          row.tenantId === tenantId &&
          row.participantIds.includes(userId),
      );
      return found !== undefined;
    },
    /**
     * Upsert by id, like the Prisma adapter: a repeated save of the same
     * conversation updates it, a new pair key must not collide inside a tenant.
     */
    async save(tenantId, conversation) {
      const index = conversations.findIndex(
        (row) => row.id === conversation.id && row.tenantId === tenantId,
      );
      if (index === -1) {
        if (
          conversations.some(
            (row) =>
              row.tenantId === tenantId &&
              row.participantPairKey === conversation.participantPairKey,
          )
        ) {
          throw new UniqueViolationError();
        }
        const stored = structuredClone({ ...conversation, tenantId });
        conversations.push(stored);
        return structuredClone(stored);
      }
      conversations[index] = structuredClone({ ...conversation, tenantId });
      return structuredClone(conversations[index]);
    },
    async addParticipant(tenantId, conversationId, userId) {
      const row = conversations.find(
        (entry) => entry.id === conversationId && entry.tenantId === tenantId,
      );
      if (row === undefined) {
        return;
      }
      if (!row.participantIds.includes(userId)) {
        row.participantIds.push(userId);
      }
    },
    async getParticipantIds(tenantId, conversationId) {
      const row = conversations.find(
        (entry) => entry.id === conversationId && entry.tenantId === tenantId,
      );
      return row === undefined ? [] : [...row.participantIds];
    },
    async touch(tenantId, conversationId, at) {
      const row = conversations.find(
        (entry) => entry.id === conversationId && entry.tenantId === tenantId,
      );
      if (row !== undefined) {
        row.updatedAt = at;
      }
    },
    async recordMessage(tenantId, conversationId, message) {
      const row = conversations.find(
        (entry) => entry.id === conversationId && entry.tenantId === tenantId,
      );
      if (row !== undefined) {
        row.lastMessage = message.body;
        row.lastMessageAt = message.createdAt;
        row.updatedAt = message.createdAt;
      }
    },
  };

  const messageRepository = {
    async findById(tenantId, messageId) {
      const found = messages.find(
        (row) => row.id === messageId && row.tenantId === tenantId,
      );
      return found === undefined ? null : structuredClone(found);
    },
    async findByIdAnyTenant(messageId) {
      const found = messages.find((row) => row.id === messageId);
      return found === undefined ? null : structuredClone(found);
    },
    async findByProviderMessageIdAnyTenant(providerMessageId) {
      return messages
        .filter((row) => row.providerMessageId === providerMessageId)
        .map((row) => structuredClone(row));
    },
    /**
     * Newest first, like the Prisma adapter: the application service reverses the
     * page so the GraphQL contract keeps the legacy ascending order.
     */
    async findByConversation(tenantId, conversationId, request) {
      const rows = messages
        .filter(
          (row) =>
            row.tenantId === tenantId &&
            row.conversationId === conversationId &&
            row.deletedAt === null,
        )
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
      const cursor = request.cursor;
      const eligible =
        cursor === null || cursor === undefined
          ? rows
          : rows.filter(
              (row) =>
                row.createdAt < cursor.createdAt ||
                (row.createdAt.getTime() === cursor.createdAt.getTime() &&
                  row.id < cursor.id),
            );
      return eligible
        .slice(0, request.limit)
        .map((row) => structuredClone(row));
    },
    async findByIdInConversation(tenantId, conversationId, messageId) {
      return messages.some(
        (row) =>
          row.tenantId === tenantId &&
          row.conversationId === conversationId &&
          row.id === messageId,
      );
    },
    async countUnread(tenantId, conversationId, userId, after) {
      return messages.filter(
        (row) =>
          row.tenantId === tenantId &&
          row.conversationId === conversationId &&
          row.senderId !== userId &&
          row.deletedAt === null &&
          (after === null || row.createdAt > after),
      ).length;
    },
    async getLastMessage(tenantId, conversationId) {
      const rows = messages.filter(
        (row) =>
          row.tenantId === tenantId && row.conversationId === conversationId,
      );
      const last = rows[rows.length - 1];
      return last === undefined ? null : structuredClone(last);
    },
    async updateDeliveryStatus(
      tenantId,
      messageId,
      deliveryStatus,
      providerMessageId = null,
    ) {
      const row = messages.find(
        (entry) => entry.id === messageId && entry.tenantId === tenantId,
      );
      if (row === undefined) {
        return null;
      }
      row.deliveryStatus = deliveryStatus;
      if (providerMessageId !== null) {
        row.providerMessageId = providerMessageId;
      }
      return structuredClone(row);
    },
    async save(tenantId, message) {
      const providerMessageId = message.providerMessageId || null;
      if (
        providerMessageId !== null &&
        messages.some((row) => row.providerMessageId === providerMessageId)
      ) {
        throw new UniqueViolationError();
      }
      const stored = structuredClone({
        ...message,
        providerMessageId,
        tenantId,
      });
      messages.push(stored);
      await conversationRepository.recordMessage(
        tenantId,
        message.conversationId,
        stored,
      );
      return structuredClone(stored);
    },
  };

  const readStateRepository = {
    async find(tenantId, conversationId, userId) {
      const found = readStates.find(
        (row) =>
          row.tenantId === tenantId &&
          row.conversationId === conversationId &&
          row.userId === userId,
      );
      return found === undefined ? null : structuredClone(found);
    },
    async upsert(tenantId, state) {
      const existing = readStates.find(
        (row) =>
          row.tenantId === tenantId &&
          row.conversationId === state.conversationId &&
          row.userId === state.userId,
      );
      const movesForward =
        existing === undefined ||
        existing.lastReadAt === null ||
        (state.lastReadAt !== null &&
          new Date(state.lastReadAt).getTime() >
            new Date(existing.lastReadAt).getTime());
      if (existing !== undefined && !movesForward) {
        return structuredClone(existing);
      }
      if (existing === undefined) {
        const created = {
          id: nextId('read'),
          tenantId,
          conversationId: state.conversationId,
          userId: state.userId,
          lastReadAt: state.lastReadAt,
          lastReadMessageId: state.lastReadMessageId,
        };
        readStates.push(created);
        return structuredClone(created);
      }
      existing.lastReadAt = state.lastReadAt;
      existing.lastReadMessageId = state.lastReadMessageId;
      return structuredClone(existing);
    },
  };

  const analytics = {
    async enqueue(fact) {
      facts.push(fact);
    },
  };

  const unitOfWork = {
    async transaction(work) {
      return work({
        conversationRepository,
        messageRepository,
        readStateRepository,
        analytics,
      });
    },
  };

  return {
    unitOfWork,
    conversationRepository,
    messageRepository,
    readStateRepository,
    analytics,
    stores: { conversations, messages, readStates, facts },
  };
}

export function makeLogger() {
  const noop = () => undefined;
  return {
    log: () => ({
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
    }),
  };
}

/**
 * Realtime publisher double.
 *
 * `subscribe` returns a real observable, because the GraphQL subscriptions pipe it
 * into `switchMap`; a stub object would only hide a broken stream wiring.
 */
export function makeRealtimePublisher() {
  const published = [];
  const streams = new Map();
  return {
    published,
    async publish(channel, event) {
      published.push({ channel, event });
      streams.get(channel)?.next(event);
    },
    subscribe(channel) {
      let stream = streams.get(channel);
      if (stream === undefined) {
        stream = new Subject();
        streams.set(channel, stream);
      }
      return stream.asObservable();
    },
    async health() {
      return true;
    },
  };
}
