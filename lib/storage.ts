import { Storage } from "@plasmohq/storage"
import {
  Conversation,
  ConversationStore,
  DEFAULT_CONVERSATION_STORE,
  PageHistory,
  Message,
  STORAGE_KEYS,
  ConversationStatus,
} from "./types"

const storage = new Storage()

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).slice(2, 11)
}

export function normalizeUrlForPageId(url: string): string {
  try {
    const urlObj = new URL(url)
    urlObj.hash = ""
    const paramsToRemove = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "referrer", "fbclid", "gclid", "msclkid"]
    paramsToRemove.forEach((param) => {
      urlObj.searchParams.delete(param)
    })
    if (urlObj.pathname.endsWith("/") && urlObj.pathname.length > 1) {
      urlObj.pathname = urlObj.pathname.slice(0, -1)
    }
    urlObj.searchParams.sort()
    let normalized = urlObj.toString()
    if (normalized.endsWith("?")) {
      normalized = normalized.slice(0, -1)
    }
    return normalized
  } catch {
    return url
  }
}

export function generatePageId(url: string): string {
  const normalized = normalizeUrlForPageId(url)
  return btoa(encodeURIComponent(normalized))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
}

async function getStore(): Promise<ConversationStore> {
  try {
    const stored = await storage.get<ConversationStore>(STORAGE_KEYS.CONVERSATIONS)
    if (stored && stored.version) {
      return stored
    }
    return DEFAULT_CONVERSATION_STORE
  } catch {
    return DEFAULT_CONVERSATION_STORE
  }
}

async function saveStore(store: ConversationStore): Promise<void> {
  await storage.set(STORAGE_KEYS.CONVERSATIONS, store)
}

export async function getOrCreatePageHistory(
  pageId: string,
  pageTitle: string,
  pageUrl: string,
): Promise<PageHistory> {
  const store = await getStore()
  let pageHistory = store.pages[pageId]
  if (!pageHistory) {
    const now = Date.now()
    pageHistory = {
      pageId,
      pageTitle,
      pageUrl,
      conversations: [],
      createdAt: now,
      updatedAt: now,
    }
    store.pages[pageId] = pageHistory
    await saveStore(store)
  }
  return pageHistory
}

export async function updatePageInfo(pageId: string, pageTitle: string, pageUrl: string): Promise<void> {
  const store = await getStore()
  const pageHistory = store.pages[pageId]
  if (pageHistory) {
    pageHistory.pageTitle = pageTitle
    pageHistory.pageUrl = pageUrl
    pageHistory.updatedAt = Date.now()
    await saveStore(store)
  }
}

export async function createConversation(
  pageId: string,
  pageTitle: string,
  pageUrl: string,
  initialMessages: Message[] = [],
): Promise<Conversation> {
  const store = await getStore()
  const now = Date.now()
  const visibleMessages = initialMessages.filter((m) => m.visible)
  const lastMessage = visibleMessages[visibleMessages.length - 1]
  const conversation: Conversation = {
    id: generateId(),
    pageId,
    pageTitle,
    pageUrl,
    messages: [...initialMessages],
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastMessagePreview: lastMessage ? lastMessage.content.slice(0, 100) : undefined,
  }
  if (!store.pages[pageId]) {
    store.pages[pageId] = {
      pageId,
      pageTitle,
      pageUrl,
      conversations: [],
      createdAt: now,
      updatedAt: now,
    }
  }
  store.pages[pageId].conversations.push(conversation)
  store.pages[pageId].updatedAt = now
  store.pages[pageId].pageTitle = pageTitle
  store.pages[pageId].pageUrl = pageUrl
  await saveStore(store)
  return conversation
}

export async function getConversation(pageId: string, conversationId: string): Promise<Conversation | null> {
  const store = await getStore()
  const pageHistory = store.pages[pageId]
  if (!pageHistory) return null
  return pageHistory.conversations.find((c) => c.id === conversationId) || null
}

export async function getLatestConversation(pageId: string): Promise<Conversation | null> {
  const store = await getStore()
  const pageHistory = store.pages[pageId]
  if (!pageHistory || pageHistory.conversations.length === 0) return null
  const sorted = [...pageHistory.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
  return sorted[0]
}

export async function addMessageToConversation(
  pageId: string,
  conversationId: string,
  message: Message,
): Promise<Conversation | null> {
  const store = await getStore()
  const pageHistory = store.pages[pageId]
  if (!pageHistory) return null
  const conversation = pageHistory.conversations.find((c) => c.id === conversationId)
  if (!conversation) return null
  conversation.messages.push(message)
  conversation.updatedAt = Date.now()
  if (message.visible) {
    conversation.lastMessagePreview = message.content.slice(0, 100)
  }
  pageHistory.updatedAt = Date.now()
  await saveStore(store)
  return conversation
}

export async function addMessagesToConversation(
  pageId: string,
  conversationId: string,
  messages: Message[],
): Promise<Conversation | null> {
  const store = await getStore()
  const pageHistory = store.pages[pageId]
  if (!pageHistory) return null
  const conversation = pageHistory.conversations.find((c) => c.id === conversationId)
  if (!conversation) return null
  conversation.messages.push(...messages)
  conversation.updatedAt = Date.now()
  const visibleMessages = messages.filter((m) => m.visible)
  const lastVisible = visibleMessages[visibleMessages.length - 1]
  if (lastVisible) {
    conversation.lastMessagePreview = lastVisible.content.slice(0, 100)
  }
  pageHistory.updatedAt = Date.now()
  await saveStore(store)
  return conversation
}

export async function updateConversationStatus(
  pageId: string,
  conversationId: string,
  status: ConversationStatus,
): Promise<Conversation | null> {
  const store = await getStore()
  const pageHistory = store.pages[pageId]
  if (!pageHistory) return null
  const conversation = pageHistory.conversations.find((c) => c.id === conversationId)
  if (!conversation) return null
  conversation.status = status
  conversation.updatedAt = Date.now()
  pageHistory.updatedAt = Date.now()
  await saveStore(store)
  return conversation
}

export async function getAllConversationsForPage(pageId: string): Promise<Conversation[]> {
  const store = await getStore()
  const pageHistory = store.pages[pageId]
  if (!pageHistory) return []
  return [...pageHistory.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteConversation(pageId: string, conversationId: string): Promise<boolean> {
  const store = await getStore()
  const pageHistory = store.pages[pageId]
  if (!pageHistory) return false
  const index = pageHistory.conversations.findIndex((c) => c.id === conversationId)
  if (index === -1) return false
  pageHistory.conversations.splice(index, 1)
  pageHistory.updatedAt = Date.now()
  if (pageHistory.conversations.length === 0) {
    delete store.pages[pageId]
  }
  await saveStore(store)
  return true
}

export async function clearAllConversations(): Promise<void> {
  await storage.set(STORAGE_KEYS.CONVERSATIONS, DEFAULT_CONVERSATION_STORE)
}

export function getLastVisibleMessagePreview(conversation: Conversation): string | null {
  const visibleMessages = conversation.messages.filter((m) => m.visible)
  const lastMessage = visibleMessages[visibleMessages.length - 1]
  return lastMessage ? lastMessage.content.slice(0, 100) : null
}
