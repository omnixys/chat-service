import strawberry
from strawberry import federation

from chat.conversation.resolvers.conversation_mutation_resolver import ConversationMutation
from chat.conversation.resolvers.conversation_query_resolver import ConversationQuery
from chat.message.resolvers.message_mutation_resolver import MessageMutation
from chat.message.resolvers.message_query_resolver import MessageQuery
from chat.message.resolvers.message_subscription_resolver import MessageSubscription


@strawberry.type
class Query(ConversationQuery, MessageQuery):
    pass


@strawberry.type
class Mutation(ConversationMutation, MessageMutation):
    pass


@strawberry.type
class Subscription(MessageSubscription):
    pass


schema = federation.Schema(
    query=Query,
    mutation=Mutation,
    subscription=Subscription,
    federation_version="2.11",
)
