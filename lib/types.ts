export interface OpenAIConfig {
  baseURL: string
  apiKey: string
  model: string
}

export const DEFAULT_OPENAI_CONFIG: OpenAIConfig = {
  baseURL: "",
  apiKey: "",
  model: "gpt-4o"
}

export interface Message {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
  visible: boolean
}

export type ConversationStatus = "active" | "completed"

export interface ConversationMeta {
  id: string
  pageId: string
  pageTitle: string
  pageUrl: string
  status: ConversationStatus
  createdAt: number
  updatedAt: number
  lastMessagePreview?: string
  messageCount: number
}

export interface ConversationMessages {
  conversationId: string
  messages: Message[]
}

export interface Conversation {
  id: string
  pageId: string
  pageTitle: string
  pageUrl: string
  messages: Message[]
  status: ConversationStatus
  createdAt: number
  updatedAt: number
  lastMessagePreview?: string
}

export interface PageInfo {
  pageId: string
  pageTitle: string
  pageUrl: string
  conversationIds: string[]
  createdAt: number
  updatedAt: number
}

export interface PageIndex {
  version: string
  pages: Record<string, PageInfo>
}

export const STORAGE_KEYS = {
  OPENAI_CONFIG: "openai-config",
  PAGE_INDEX: "socrates-page-index",
  CONV_META_PREFIX: "socrates-conv-meta-",
  CONV_MSGS_PREFIX: "socrates-conv-msgs-",
}

export const CURRENT_STORE_VERSION = "2.0.0"

export const DEFAULT_PAGE_INDEX: PageIndex = {
  version: CURRENT_STORE_VERSION,
  pages: {},
}

export function convMetaKey(convId: string): string {
  return STORAGE_KEYS.CONV_META_PREFIX + convId
}

export function convMsgsKey(convId: string): string {
  return STORAGE_KEYS.CONV_MSGS_PREFIX + convId
}

export function mergeConversation(meta: ConversationMeta, msgs: ConversationMessages): Conversation {
  return {
    id: meta.id,
    pageId: meta.pageId,
    pageTitle: meta.pageTitle,
    pageUrl: meta.pageUrl,
    messages: msgs.messages,
    status: meta.status,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    lastMessagePreview: meta.lastMessagePreview,
  }
}

export function splitConversation(conv: Conversation): { meta: ConversationMeta; msgs: ConversationMessages } {
  const visibleMessages = conv.messages.filter((m) => m.visible)
  const lastMessage = visibleMessages[visibleMessages.length - 1]
  
  const meta: ConversationMeta = {
    id: conv.id,
    pageId: conv.pageId,
    pageTitle: conv.pageTitle,
    pageUrl: conv.pageUrl,
    status: conv.status,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    lastMessagePreview: lastMessage ? lastMessage.content.slice(0, 100) : conv.lastMessagePreview,
    messageCount: conv.messages.length,
  }
  
  const msgs: ConversationMessages = {
    conversationId: conv.id,
    messages: conv.messages,
  }
  
  return { meta, msgs }
}
