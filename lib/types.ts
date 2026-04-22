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

export interface ConversationRound {
  id: string
  pageKey: string
  messages: Message[]
  completed: boolean
  createdAt: number
  updatedAt: number
  pageTitle: string
  pageUrl: string
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
  "dclid",
  "ref",
  "source"
]

export const SUMMARY_KEYWORDS: string[] = [
  "总结",
  "帮我总结",
  "请总结",
  "总结一下",
  "summarize",
  "summary"
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
  return SUMMARY_KEYWORDS.some((kw) => lower.includes(kw))
}
