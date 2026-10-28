# ADR 001 — Channel Adapter Architecture for Omnichannel Delivery

**Status:** Accepted  
**Date:** 2026-07-07

## Context

The Chat Service needs to support multiple delivery channels (in-app realtime, WhatsApp, email, SMS, and future channels like Signal, Telegram, Slack, push notifications) without leaking provider-specific logic into the communication domain.

## Decision

We introduce a layered channel adapter architecture that keeps the Chat Service fully channel-agnostic:

```
MessageService
    ↓
MessageDispatcher      — orchestrates delivery
    ↓
DeliveryPolicy         — business decisions (user prefs, fallback, rules)
    ↓
MessageRouter          — technical resolution (ChannelType → ChannelAdapter)
    ↓
ChannelAdapter         — outbound delivery interface
    ↓
Communication Gateway  — future external provider integration
```

### Key components

| Component              | Responsibility                                         | Location            |
| ---------------------- | ------------------------------------------------------ | ------------------- |
| `CommunicationChannel` | Value object wrapping `ChannelType` + future metadata  | Domain              |
| `DeliveryPolicy`       | Determines which channels to deliver to                | Port (interface)    |
| `MessageRouter`        | Resolves `CommunicationChannel` → `ChannelAdapter`     | Application service |
| `MessageDispatcher`    | Coordinates policy → router → adapter chain            | Application service |
| `ChannelAdapter`       | Outbound delivery contract; `send()`, `capabilities()` | Port (interface)    |
| `ChannelCapabilities`  | Per-channel feature flags                              | Domain model        |

### Design decisions

1. **Outbound-only adapters.** `ChannelAdapter` has no `receive()` — inbound messages arrive exclusively via the Communication Gateway and are fed into the Chat Service through its GraphQL API.

2. **Channel is per-message, not per-conversation.** A single conversation can span multiple channels (e.g., guest sends via WhatsApp, support replies in-app). The `Conversation` never stores a channel.

3. **Provider-neutral Message.** The `Message` entity contains no provider-specific fields (`whatsappMessageId`, `smtpMessageId`, etc.). External IDs are managed exclusively in the future Communication Gateway.

4. **DeliveryPolicy for business rules.** The `DeliveryPolicy` is the single extension point for channel selection, fallback ordering, tenant configuration, and user preferences — without touching `MessageService`, `MessageDispatcher`, or `MessageRouter`.

5. **Router is purely technical.** `MessageRouter` only maps `ChannelType` → `ChannelAdapter`. No business logic, no fallbacks, no user preferences.

6. **Dependency direction.** All business components depend on ports (interfaces). Concrete adapters, policies, and router registration happen only in the composition root (`main.py`).

7. **Realtime remains unchanged.** Only `InAppChannelAdapter` publishes to the `RealtimePublisher`. GraphQL subscriptions continue to consume from the same realtime channels.

## Consequences

### Positive

- Adding a new channel requires only: a new `ChannelAdapter` implementation + registration in the router dict. No changes to `MessageService`, repositories, or GraphQL schema.
- The Chat Service is fully prepared for a future Communication Gateway that implements the placeholder adapters.
- All delivery decisions are captured in one place (`DeliveryPolicy`).
- No provider-specific IDs or logic exist in the domain.
- The architecture supports multi-channel delivery for a single message.

### Negative

- Increased indirection compared to the previous direct `MessageService → RealtimePublisher` flow.
- Placeholder adapters raise `NotImplementedError` — a Communication Gateway must be implemented before external channels go live.

## Future Communication Gateway

The Communication Gateway will:

1. Implement real `ChannelAdapter` interfaces for WhatsApp, Email, SMS, etc.
2. Manage external provider IDs (WhatsApp message IDs, SMTP message IDs, etc.)
3. Expose webhooks to receive inbound messages and feed them into the Chat Service
4. Handle provider-specific retry, rate limiting, and delivery receipts

No Chat Service code changes are required when the Gateway is introduced.

## Architecture Diagram

```
                 ┌─────────────┐
                 │   GraphQL   │
                 │  Mutation   │
                 └──────┬──────┘
                        │
                        ▼
                ┌───────────────┐
                │ MessageService│
                │  validate,    │
                │  persist,     │
                │  dispatch     │
                └───────┬───────┘
                        │
                        ▼
              ┌─────────────────┐
              │MessageDispatcher│
              │ orchestrate     │
              └───────┬─────────┘
                      │
                      ▼
              ┌─────────────────┐
              │ DeliveryPolicy  │  ← business decisions
              │ (determine      │     (user prefs, fallbacks,
              │  channels)      │      business rules)
              └───────┬─────────┘
                      │
                      ▼
              ┌─────────────────┐
              │ MessageRouter   │  ← technical resolution
              │ (ChannelType →  │     (no business logic)
              │  ChannelAdapter)│
              └───┬────┬────┬───┘
                  │    │    │
        ┌─────────┤    │    ├──────────┐
        ▼         ▼    ▼    ▼          ▼
  ┌─────────┐ ┌────────┐ ┌────────┐ ┌────────┐
  │  InApp  │ │WhatsApp│ │ Email  │ │  SMS   │
  │ Adapter │ │Adapter │ │Adapter │ │Adapter │
  │  (impl) │ │(stub)  │ │(stub)  │ │(stub)  │
  └────┬────┘ └────────┘ └────────┘ └────────┘
       │
       ▼
 ┌──────────────┐       ┌──────────────────┐
 │  Realtime    │       │ GraphQL          │
 │  Publisher   │──────▶│ Subscription     │
 │ (event bus)  │       │ (messageReceived,│
 └──────────────┘       │ conversationUpd) │
                        └──────────────────┘

        ┌───────────────────────────────┐
  ─ ─ ▶│  Future Communication Gateway │─ ─ ▶ Twilio, SMTP, WhatsApp API, etc.
        └───────────────────────────────┘
        (placeholder adapters will
         delegate to gateway when
         implemented)
```
