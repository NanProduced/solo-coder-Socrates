import { UnderstandingStatus, KnowledgeDocument, KeyConcept, KnowledgeCard } from "./types"

export function parseLLMJson(text: string): any {
  let cleaned = text.trim()
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim()
  }
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    cleaned = jsonMatch[0]
  }
  return JSON.parse(cleaned)
}

export function downloadMarkdown(content: string, filename?: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${filename || "知识文档"}.md`
  a.click()
  URL.revokeObjectURL(url)
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  if (isToday) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  }
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) {
    return "昨天 " + date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  }
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })
}

export function formatDateGroup(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return "今天"
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return "昨天"
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  if (date >= sevenDaysAgo) return "最近七天"
  const thirtyDaysAgo = new Date(now)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  if (date >= thirtyDaysAgo) return "最近三十天"
  return "更早"
}

export function extractHostname(url: string): string {
  try {
    const urlObj = new URL(url)
    if (urlObj.protocol === "file:") {
      const filename = urlObj.pathname.split("/").pop() || ""
      return filename ? decodeURIComponent(filename) : "本地文件"
    }
    return urlObj.hostname
  } catch {
    return url
  }
}

export function buildStatusContext(status: UnderstandingStatus | null): string {
  if (!status) return ""
  const parts = [
    `[当前学习状态]`,
    `阶段: ${status.currentStage}`,
  ]
  if (status.mastered.length > 0) {
    parts.push(`已掌握: ${status.mastered.join("、")}`)
  }
  if (status.pendingClarification.length > 0) {
    parts.push(`待澄清: ${status.pendingClarification.join("、")}`)
  }
  if (status.nextThinkingDirection) {
    parts.push(`建议思考方向: ${status.nextThinkingDirection}`)
  }
  parts.push(`请根据以上状态调整提问策略：对已掌握的概念可以深入追问，对待澄清的概念应从不同角度引导。`)
  return parts.join("\n")
}

export function mergeKnowledgeDoc(
  oldDoc: KnowledgeDocument | null,
  updates: {
    summary?: string
    keyConcepts?: KeyConcept[]
    knowledgeCards?: KnowledgeCard[]
    understandingStatus?: UnderstandingStatus
    pageKey?: string
    pageTitle?: string
    pageUrl?: string
  }
): KnowledgeDocument {
  const now = Date.now()
  if (!oldDoc) {
    return {
      pageKey: updates.pageKey ?? "",
      summary: updates.summary ?? "",
      keyConcepts: updates.keyConcepts ?? [],
      knowledgeCards: updates.knowledgeCards ?? [],
      understandingStatus: updates.understandingStatus ?? {
        currentStage: "初步接触",
        mastered: [],
        pendingClarification: [],
        evidenceStatus: "低",
        nextThinkingDirection: "",
        updatedAt: now,
      },
      exportedMarkdown: undefined,
      createdAt: now,
      updatedAt: now,
      pageTitle: updates.pageTitle ?? "",
      pageUrl: updates.pageUrl ?? "",
    }
  }
  return {
    ...oldDoc,
    summary: updates.summary ?? oldDoc.summary,
    keyConcepts: updates.keyConcepts
      ? mergeConcepts(oldDoc.keyConcepts, updates.keyConcepts)
      : oldDoc.keyConcepts,
    knowledgeCards: updates.knowledgeCards ?? oldDoc.knowledgeCards,
    understandingStatus: updates.understandingStatus ?? oldDoc.understandingStatus,
    updatedAt: now,
    createdAt: oldDoc.createdAt,
    pageTitle: oldDoc.pageTitle,
    pageUrl: oldDoc.pageUrl,
    pageKey: oldDoc.pageKey,
  }
}

function mergeConcepts(old: KeyConcept[], updated: KeyConcept[]): KeyConcept[] {
  const map = new Map(old.map(c => [c.name, c]))
  for (const c of updated) {
    map.set(c.name, c)
  }
  return Array.from(map.values())
}

export function findRelatedConcepts(
  currentConcepts: string[],
  allDocs: KnowledgeDocument[],
  currentDocKey: string
): { docTitle: string; concept: string; description: string }[] {
  const currentSet = new Set(currentConcepts.map(c => c.toLowerCase()))
  const related: { docTitle: string; concept: string; description: string }[] = []

  for (const doc of allDocs) {
    if (doc.pageKey === currentDocKey) continue
    for (const concept of doc.keyConcepts) {
      if (currentSet.has(concept.name.toLowerCase())) {
        related.push({
          docTitle: doc.pageTitle,
          concept: concept.name,
          description: concept.description,
        })
      }
    }
  }
  return related.slice(0, 5)
}
