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
