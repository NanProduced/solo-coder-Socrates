import { Storage } from "@plasmohq/storage"
import { ConversationRound } from "./types"

const storage = new Storage({ area: "local" })

const CONVERSATION_KEY_PREFIX = "page-conversations:"

export function getPageConversationsKey(pageKey: string): string {
  return CONVERSATION_KEY_PREFIX + pageKey
}

export async function loadPageConversations(
  pageKey: string
): Promise<ConversationRound[]> {
  const key = getPageConversationsKey(pageKey)
  const data = await storage.get<ConversationRound[]>(key)
  return data ?? []
}

export async function savePageConversations(
  pageKey: string,
  rounds: ConversationRound[]
): Promise<void> {
  const key = getPageConversationsKey(pageKey)
  await storage.set(key, rounds)
}
