import { AdminConversationsApi, ConversationMessagesApi, ConversationsApi, CreateConversationApi, MarkConversationReadApi, MessagePartnersApi, SendConversationMessageApi } from "../apiMethod";
import { toData, toResult } from "./responseHandlers";

export const handleGetMessagePartners = () => toData(MessagePartnersApi());
export const handleCreateConversation = (params) => toResult(CreateConversationApi(params));
export const handleGetConversations = () => toData(ConversationsApi());
export const handleGetConversationMessages = (id, params = {}) => toData(ConversationMessagesApi(id, params));
export const handleGetNewMessages = (id, since, limit = 50) => handleGetConversationMessages(id, { ...(since ? { since } : {}), limit });
export const handleSendConversationMessage = (id, params) => toResult(SendConversationMessageApi(id, params));
export const handleMarkConversationRead = (id) => toResult(MarkConversationReadApi(id));
export const handleGetAdminConversations = (params) => toData(AdminConversationsApi(params));
