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

export type ConversationMode = "free" | "guided"

export interface StructuredOutput {
  mode: "question" | "summary"
  answer: string
  question: string
  options?: string[]
}

export interface StreamState {
  isStreaming: boolean
  abortController: AbortController | null
}

export interface Message {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
  visible: boolean
  structuredOutput?: StructuredOutput
  isStreaming?: boolean
}

export interface ConversationRound {
  id: string
  pageKey: string
  messages: Message[]
  completed: boolean
  createdAt: number
  updatedAt: number
  pageTitle: string
  pageUrl: string
  conversationMode?: ConversationMode
}

export const TRACKING_PARAMS: string[] = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid"
]

export const SUMMARY_KEYWORDS: string[] = [
  "帮我总结",
  "请总结",
  "总结一下",
  "总结吧",
  "summarize",
  "summary",
  "give me a summary",
  "please summarize"
]

export function generatePageKey(url: string): string {
  try {
    const urlObj = new URL(url)

    let key = urlObj.origin + (urlObj.pathname.replace(/\/+$/, "") || "/")

    const filteredParams = new URLSearchParams()
    const sortedKeys = [...new Set(Array.from(urlObj.searchParams.keys()))].sort()
    for (const k of sortedKeys) {
      if (!TRACKING_PARAMS.includes(k.toLowerCase())) {
        filteredParams.set(k, urlObj.searchParams.get(k) ?? "")
      }
    }
    const paramStr = filteredParams.toString()
    if (paramStr) key += "?" + paramStr

    return key
  } catch {
    return url
  }
}

export function isSummaryRequest(content: string): boolean {
  const lower = content.toLowerCase().trim()
  if (SUMMARY_KEYWORDS.some((kw) => lower.includes(kw))) return true
  if (/^总结[了啊吧]?$/i.test(lower.trim())) return true
  return false
}

export interface KeyConcept {
  id: string
  term: string
  definition: string
  importance: "core" | "important" | "supporting"
  relationships?: string[]
}

export interface KnowledgeCard {
  id: string
  title: string
  content: string
  category: "definition" | "example" | "principle" | "relationship" | "application"
  tags?: string[]
  sourceReference?: string
}

export interface UnderstandingState {
  currentPhase: "introductory" | "exploring" | "deepening" | "synthesizing" | "mastering"
  phaseDescription: string
  mastered: string[]
  needClarification: {
    concept: string
    reason: string
    priority: "high" | "medium" | "low"
  }[]
  evidenceStatus: {
    strong: string[]
    weak: string[]
    missing: string[]
  }
  nextSteps: {
    action: string
    rationale: string
    priority: "high" | "medium" | "low"
  }[]
  lastUpdated: number
}

export interface KnowledgeDocument {
  id: string
  pageKey: string
  pageTitle: string
  pageUrl: string
  summary: string
  keyConcepts: KeyConcept[]
  knowledgeCards: KnowledgeCard[]
  understandingState: UnderstandingState
  conversationRounds: string[]
  createdAt: number
  updatedAt: number
  version: number
}

export type KnowledgeDocStatus = "idle" | "generating" | "ready" | "error"
export type GenerationStage = "summary" | "concepts" | "cards" | "understanding" | "export"
