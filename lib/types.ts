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

export interface PageHistory {
  pageId: string
  pageTitle: string
  pageUrl: string
  conversations: Conversation[]
  createdAt: number
  updatedAt: number
}

export interface ConversationStore {
  version: string
  pages: Record<string, PageHistory>
}

export const STORAGE_KEYS = {
  OPENAI_CONFIG: "openai-config",
  CONVERSATIONS: "socrates-conversations",
}

export const CURRENT_STORE_VERSION = "1.0.0"

export const DEFAULT_CONVERSATION_STORE: ConversationStore = {
  version: CURRENT_STORE_VERSION,
  pages: {},
}
