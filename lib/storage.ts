import { Storage } from "@plasmohq/storage"
import { ConversationRound, UnderstandingStatus, KnowledgeDocument, ReviewSchedule, Note } from "./types"

const storage = new Storage({ area: "local" })

const CONVERSATION_KEY_PREFIX = "page-conversations:"
const UNDERSTANDING_STATUS_KEY_PREFIX = "understanding-status:"
const KNOWLEDGE_DOC_KEY_PREFIX = "knowledge-doc:"
const REVIEW_SCHEDULE_KEY_PREFIX = "review-schedule:"
const NOTES_KEY_PREFIX = "notes:"

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

export async function loadUnderstandingStatus(
  pageKey: string
): Promise<UnderstandingStatus | null> {
  const key = UNDERSTANDING_STATUS_KEY_PREFIX + pageKey
  const data = await storage.get<UnderstandingStatus>(key)
  return data ?? null
}

export async function saveUnderstandingStatus(
  pageKey: string,
  status: UnderstandingStatus
): Promise<void> {
  const key = UNDERSTANDING_STATUS_KEY_PREFIX + pageKey
  await storage.set(key, status)
}

export async function loadKnowledgeDocument(
  pageKey: string
): Promise<KnowledgeDocument | null> {
  const key = KNOWLEDGE_DOC_KEY_PREFIX + pageKey
  const data = await storage.get<KnowledgeDocument>(key)
  return data ?? null
}

export async function saveKnowledgeDocument(
  pageKey: string,
  doc: KnowledgeDocument
): Promise<void> {
  const key = KNOWLEDGE_DOC_KEY_PREFIX + pageKey
  await storage.set(key, doc)
}

export async function deleteKnowledgeDocument(
  pageKey: string
): Promise<void> {
  const key = KNOWLEDGE_DOC_KEY_PREFIX + pageKey
  await chrome.storage.local.remove(key)
}

export async function deleteKnowledgeDocuments(
  pageKeys: string[]
): Promise<void> {
  const keys = pageKeys.map((pk) => KNOWLEDGE_DOC_KEY_PREFIX + pk)
  if (keys.length > 0) {
    await chrome.storage.local.remove(keys)
  }
}

export async function loadAllKnowledgeDocuments(): Promise<KnowledgeDocument[]> {
  const allData = await chrome.storage.local.get(null)
  const docs: KnowledgeDocument[] = []

  for (const [key, value] of Object.entries(allData)) {
    if (key.startsWith(KNOWLEDGE_DOC_KEY_PREFIX) && value) {
      docs.push(value as KnowledgeDocument)
    }
  }

  docs.sort((a, b) => b.updatedAt - a.updatedAt)
  return docs
}

export async function saveReviewSchedules(
  pageKey: string,
  schedules: ReviewSchedule[]
): Promise<void> {
  const key = REVIEW_SCHEDULE_KEY_PREFIX + pageKey
  await chrome.storage.local.set({ [key]: schedules })
}

export async function loadReviewSchedules(
  pageKey: string
): Promise<ReviewSchedule[]> {
  const key = REVIEW_SCHEDULE_KEY_PREFIX + pageKey
  const data = await chrome.storage.local.get(key)
  return (data[key] as ReviewSchedule[]) || []
}

export async function loadAllReviewSchedules(): Promise<ReviewSchedule[]> {
  const allData = await chrome.storage.local.get(null)
  const schedules: ReviewSchedule[] = []

  for (const [key, value] of Object.entries(allData)) {
    if (key.startsWith(REVIEW_SCHEDULE_KEY_PREFIX) && Array.isArray(value)) {
      schedules.push(...(value as ReviewSchedule[]))
    }
  }

  return schedules
}

export async function loadDueReviews(): Promise<ReviewSchedule[]> {
  const all = await loadAllReviewSchedules()
  const now = Date.now()
  return all.filter((s) => s.nextReviewAt <= now)
}

export async function saveNotes(
  pageKey: string,
  notes: Note[]
): Promise<void> {
  const key = NOTES_KEY_PREFIX + pageKey
  await chrome.storage.local.set({ [key]: notes })
}

export async function loadNotes(
  pageKey: string
): Promise<Note[]> {
  const key = NOTES_KEY_PREFIX + pageKey
  const data = await chrome.storage.local.get(key)
  return (data[key] as Note[]) || []
}

export async function deleteNotes(
  pageKeys: string[]
): Promise<void> {
  const keys = pageKeys.map((pk) => NOTES_KEY_PREFIX + pk)
  if (keys.length > 0) {
    await chrome.storage.local.remove(keys)
  }
}
