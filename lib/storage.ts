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

function parseRoundsValue(value: unknown): ConversationRound[] {
  if (Array.isArray(value)) return value
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

async function getAllRawEntries(): Promise<[string, ConversationRound[]][]> {
  const allData = await chrome.storage.local.get(null)
  const entries: [string, ConversationRound[]][] = []

  for (const [key, value] of Object.entries(allData)) {
    if (key.startsWith(CONVERSATION_KEY_PREFIX)) {
      const rounds = parseRoundsValue(value)
      if (rounds.length > 0) {
        entries.push([key, rounds])
      }
    }
  }

  return entries
}

export async function loadAllConversations(): Promise<ConversationRound[]> {
  const entries = await getAllRawEntries()
  const allRounds: ConversationRound[] = []

  for (const [, rounds] of entries) {
    allRounds.push(...rounds)
  }

  allRounds.sort((a, b) => b.updatedAt - a.updatedAt)

  return allRounds
}

export async function deleteConversationRound(
  roundId: string
): Promise<void> {
  const entries = await getAllRawEntries()

  for (const [key, rounds] of entries) {
    const filtered = rounds.filter((r) => r.id !== roundId)
    if (filtered.length !== rounds.length) {
      if (filtered.length === 0) {
        await chrome.storage.local.remove(key)
      } else {
        await storage.set(key.slice(CONVERSATION_KEY_PREFIX.length), filtered)
      }
      break
    }
  }
}

export async function deleteConversationRounds(
  roundIds: string[]
): Promise<void> {
  const idSet = new Set(roundIds)
  const entries = await getAllRawEntries()

  for (const [key, rounds] of entries) {
    const filtered = rounds.filter((r) => !idSet.has(r.id))
    if (filtered.length !== rounds.length) {
      if (filtered.length === 0) {
        await chrome.storage.local.remove(key)
      } else {
        await storage.set(key.slice(CONVERSATION_KEY_PREFIX.length), filtered)
      }
    }
  }
}

export async function deleteAllConversations(): Promise<void> {
  const allData = await chrome.storage.local.get(null)

  const keysToRemove = Object.keys(allData).filter((key) =>
    key.startsWith(CONVERSATION_KEY_PREFIX)
  )

  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove)
  }
}
