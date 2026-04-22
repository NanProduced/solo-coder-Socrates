import { Storage } from "@plasmohq/storage"
import {
  Conversation,
  ConversationMeta,
  ConversationMessages,
  DEFAULT_PAGE_INDEX,
  PageInfo,
  PageIndex,
  STORAGE_KEYS,
  Message,
  ConversationStatus,
  convMetaKey,
  convMsgsKey,
  mergeConversation,
  splitConversation,
} from "./types"

const storage = new Storage()

const MAX_CONVERSATIONS_PER_PAGE = 10
const MAX_MESSAGES_PER_CONVERSATION = 50

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

function trimMessagesForStorage(messages: Message[]): Message[] {
  const visibleMessages = messages.filter((m) => m.visible)
  if (visibleMessages.length <= MAX_MESSAGES_PER_CONVERSATION) {
    return visibleMessages
  }
  return visibleMessages.slice(visibleMessages.length - MAX_MESSAGES_PER_CONVERSATION)
}

async function getPageIndex(): Promise<PageIndex> {
  try {
    const stored = await storage.get<PageIndex>(STORAGE_KEYS.PAGE_INDEX)
    if (stored && stored.version) {
      return stored
    }
    return DEFAULT_PAGE_INDEX
  } catch {
    return DEFAULT_PAGE_INDEX
  }
}

async function savePageIndex(index: PageIndex): Promise<void> {
  await storage.set(STORAGE_KEYS.PAGE_INDEX, index)
}

async function getConversationMeta(convId: string): Promise<ConversationMeta | null> {
  try {
    const key = convMetaKey(convId)
    const meta = await storage.get<ConversationMeta>(key)
    if (meta && meta.id) {
      return meta
    }
    return null
  } catch {
    return null
  }
}

async function saveConversationMeta(meta: ConversationMeta): Promise<void> {
  const key = convMetaKey(meta.id)
  await storage.set(key, meta)
}

async function getConversationMessages(convId: string): Promise<ConversationMessages | null> {
  try {
    const key = convMsgsKey(convId)
    const msgs = await storage.get<ConversationMessages>(key)
    if (msgs && msgs.conversationId) {
      return msgs
    }
    return null
  } catch {
    return null
  }
}

async function saveConversationMessages(msgs: ConversationMessages): Promise<void> {
  const key = convMsgsKey(msgs.conversationId)
  await storage.set(key, msgs)
}

async function deleteConversationStorage(convId: string): Promise<void> {
  const metaKey = convMetaKey(convId)
  const msgsKey = convMsgsKey(convId)
  await Promise.all([
    storage.remove(metaKey),
    storage.remove(msgsKey),
  ])
}

async function cleanupOldConversations(pageId: string, keepCount: number): Promise<void> {
  const index = await getPageIndex()
  const pageInfo = index.pages[pageId]
  
  if (!pageInfo || pageInfo.conversationIds.length <= keepCount) {
    return
  }
  
  const convIds = [...pageInfo.conversationIds]
  const metas = await Promise.all(
    convIds.map((id) => getConversationMeta(id))
  )
  
  const validMetas = metas
    .filter((m): m is ConversationMeta & { id: string } => m !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  
  const toDelete = validMetas.slice(keepCount)
  
  for (const meta of toDelete) {
    const idx = pageInfo.conversationIds.indexOf(meta.id)
    if (idx !== -1) {
      pageInfo.conversationIds.splice(idx, 1)
    }
    await deleteConversationStorage(meta.id)
  }
  
  pageInfo.updatedAt = Date.now()
  await savePageIndex(index)
}

export async function getOrCreatePageInfo(
  pageId: string,
  pageTitle: string,
  pageUrl: string,
): Promise<PageInfo> {
  const index = await getPageIndex()
  let pageInfo = index.pages[pageId]
  if (!pageInfo) {
    const now = Date.now()
    pageInfo = {
      pageId,
      pageTitle,
      pageUrl,
      conversationIds: [],
      createdAt: now,
      updatedAt: now,
    }
    index.pages[pageId] = pageInfo
    await savePageIndex(index)
  }
  return pageInfo
}

export async function updatePageInfo(pageId: string, pageTitle: string, pageUrl: string): Promise<void> {
  const index = await getPageIndex()
  const pageInfo = index.pages[pageId]
  if (pageInfo) {
    pageInfo.pageTitle = pageTitle
    pageInfo.pageUrl = pageUrl
    pageInfo.updatedAt = Date.now()
    await savePageIndex(index)
  }
}

export async function createConversation(
  pageId: string,
  pageTitle: string,
  pageUrl: string,
  initialMessages: Message[] = [],
): Promise<Conversation> {
  const now = Date.now()
  const convId = generateId()
  
  const trimmedMessages = trimMessagesForStorage(initialMessages)
  const lastMessage = trimmedMessages[trimmedMessages.length - 1]
  
  const conversation: Conversation = {
    id: convId,
    pageId,
    pageTitle,
    pageUrl,
    messages: [...initialMessages],
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastMessagePreview: lastMessage ? lastMessage.content.slice(0, 100) : undefined,
  }
  
  const { meta, msgs } = splitConversation(conversation)
  
  const index = await getPageIndex()
  
  if (!index.pages[pageId]) {
    index.pages[pageId] = {
      pageId,
      pageTitle,
      pageUrl,
      conversationIds: [],
      createdAt: now,
      updatedAt: now,
    }
  }
  
  index.pages[pageId].conversationIds.push(convId)
  index.pages[pageId].updatedAt = now
  index.pages[pageId].pageTitle = pageTitle
  index.pages[pageId].pageUrl = pageUrl
  
  try {
    await Promise.all([
      savePageIndex(index),
      saveConversationMeta(meta),
      saveConversationMessages({ ...msgs, messages: trimmedMessages }),
    ])
  } catch (saveError) {
    console.error("保存对话失败，尝试清理旧数据:", saveError)
    
    try {
      await cleanupOldConversations(pageId, Math.floor(MAX_CONVERSATIONS_PER_PAGE / 2))
      
      await Promise.all([
        savePageIndex(index),
        saveConversationMeta(meta),
        saveConversationMessages({ ...msgs, messages: trimmedMessages }),
      ])
    } catch (cleanupError) {
      console.error("清理后仍然保存失败:", cleanupError)
      throw saveError
    }
  }
  
  if (index.pages[pageId].conversationIds.length > MAX_CONVERSATIONS_PER_PAGE + 2) {
    ;(async () => {
      try {
        await cleanupOldConversations(pageId, MAX_CONVERSATIONS_PER_PAGE)
      } catch (e) {
        console.error("清理旧对话失败:", e)
      }
    })()
  }
  
  return conversation
}

export async function getConversation(pageId: string, conversationId: string): Promise<Conversation | null> {
  const meta = await getConversationMeta(conversationId)
  if (!meta) return null
  
  const msgs = await getConversationMessages(conversationId)
  if (!msgs) return null
  
  return mergeConversation(meta, msgs)
}

export async function getLatestConversation(pageId: string): Promise<Conversation | null> {
  const index = await getPageIndex()
  const pageInfo = index.pages[pageId]
  
  if (!pageInfo || pageInfo.conversationIds.length === 0) return null
  
  const convIds = [...pageInfo.conversationIds]
  
  const metas = await Promise.all(
    convIds.map((id) => getConversationMeta(id))
  )
  
  const validMetas = metas.filter((m): m is ConversationMeta => m !== null)
  
  if (validMetas.length === 0) return null
  
  validMetas.sort((a, b) => b.updatedAt - a.updatedAt)
  
  const latestMeta = validMetas[0]
  const msgs = await getConversationMessages(latestMeta.id)
  
  if (!msgs) return null
  
  return mergeConversation(latestMeta, msgs)
}

export async function addMessageToConversation(
  pageId: string,
  conversationId: string,
  message: Message,
): Promise<Conversation | null> {
  return addMessagesToConversation(pageId, conversationId, [message])
}

export async function addMessagesToConversation(
  pageId: string,
  conversationId: string,
  messages: Message[],
): Promise<Conversation | null> {
  const meta = await getConversationMeta(conversationId)
  if (!meta) return null
  
  const msgs = await getConversationMessages(conversationId)
  if (!msgs) return null
  
  msgs.messages.push(...messages)
  
  const trimmedMessages = trimMessagesForStorage(msgs.messages)
  const lastMessage = trimmedMessages[trimmedMessages.length - 1]
  
  meta.updatedAt = Date.now()
  meta.messageCount = trimmedMessages.length
  if (lastMessage) {
    meta.lastMessagePreview = lastMessage.content.slice(0, 100)
  }
  
  try {
    await Promise.all([
      saveConversationMeta(meta),
      saveConversationMessages({ ...msgs, messages: trimmedMessages }),
    ])
  } catch (saveError) {
    console.error("保存消息失败:", saveError)
    
    try {
      await cleanupOldConversations(pageId, Math.floor(MAX_CONVERSATIONS_PER_PAGE / 2))
      
      await Promise.all([
        saveConversationMeta(meta),
        saveConversationMessages({ ...msgs, messages: trimmedMessages }),
      ])
    } catch (cleanupError) {
      console.error("清理后仍然保存失败:", cleanupError)
      throw saveError
    }
  }
  
  const index = await getPageIndex()
  if (index.pages[pageId]) {
    index.pages[pageId].updatedAt = Date.now()
    await savePageIndex(index)
  }
  
  return mergeConversation(meta, msgs)
}

export async function updateConversationStatus(
  pageId: string,
  conversationId: string,
  status: ConversationStatus,
): Promise<Conversation | null> {
  const meta = await getConversationMeta(conversationId)
  if (!meta) return null
  
  meta.status = status
  meta.updatedAt = Date.now()
  
  await saveConversationMeta(meta)
  
  const index = await getPageIndex()
  if (index.pages[pageId]) {
    index.pages[pageId].updatedAt = Date.now()
    await savePageIndex(index)
  }
  
  const msgs = await getConversationMessages(conversationId)
  if (!msgs) return null
  
  return mergeConversation(meta, msgs)
}

export async function getAllConversationsForPage(pageId: string): Promise<Conversation[]> {
  const index = await getPageIndex()
  const pageInfo = index.pages[pageId]
  
  if (!pageInfo || pageInfo.conversationIds.length === 0) return []
  
  const conversations: Conversation[] = []
  
  for (const convId of pageInfo.conversationIds) {
    const conv = await getConversation(pageId, convId)
    if (conv) {
      conversations.push(conv)
    }
  }
  
  conversations.sort((a, b) => b.updatedAt - a.updatedAt)
  
  return conversations
}

export async function deleteConversation(pageId: string, conversationId: string): Promise<boolean> {
  const index = await getPageIndex()
  const pageInfo = index.pages[pageId]
  
  if (!pageInfo) return false
  
  const convIndex = pageInfo.conversationIds.indexOf(conversationId)
  if (convIndex === -1) return false
  
  pageInfo.conversationIds.splice(convIndex, 1)
  pageInfo.updatedAt = Date.now()
  
  if (pageInfo.conversationIds.length === 0) {
    delete index.pages[pageId]
  }
  
  await Promise.all([
    savePageIndex(index),
    deleteConversationStorage(conversationId),
  ])
  
  return true
}

export async function clearAllConversations(): Promise<void> {
  const index = await getPageIndex()
  
  const allConvIds: string[] = []
  for (const pageId in index.pages) {
    allConvIds.push(...index.pages[pageId].conversationIds)
  }
  
  await Promise.all([
    storage.set(STORAGE_KEYS.PAGE_INDEX, DEFAULT_PAGE_INDEX),
    ...allConvIds.map((id) => deleteConversationStorage(id)),
  ])
}

export function getLastVisibleMessagePreview(conversation: Conversation): string | null {
  const visibleMessages = conversation.messages.filter((m) => m.visible)
  const lastMessage = visibleMessages[visibleMessages.length - 1]
  return lastMessage ? lastMessage.content.slice(0, 100) : null
}
