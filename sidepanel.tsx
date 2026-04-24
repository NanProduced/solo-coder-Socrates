import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import {
  OpenAIConfig,
  DEFAULT_OPENAI_CONFIG,
  Message,
  ConversationRound,
  ConversationMode,
  StreamState,
  generatePageKey,
  isSummaryRequest,
  UnderstandingStatus,
  KnowledgeDocument,
} from "./lib/types"
import {
  loadPageConversations,
  savePageConversations,
  loadAllConversations,
  deleteConversationRounds,
  deleteAllConversations,
  loadUnderstandingStatus,
  saveUnderstandingStatus,
  loadKnowledgeDocument,
  saveKnowledgeDocument,
} from "./lib/storage"
import {
  extractPdfFromUrl,
  extractPdfViaInjection,
  isPdfUrl,
  isFileUrl,
  getCookiesForUrl,
  checkFileSchemeAccess,
} from "./lib/pdf-extract"
import {
  smartTruncate,
  buildContextPrompt,
  type ContentMeta,
} from "./lib/content-utils"
import { callLLMStream, callLLM, LLMError } from "./lib/llm"
import {
  compressMessages,
  analyzeMessagesForCompression,
} from "./lib/context-compression"
import {
  validateOutput,
  extractStreamingDisplay,
  formatStructuredContent,
  formatDisplayContent,
} from "./lib/output-contract"
import "./style.css"

const SOCRATES_SYSTEM_PROMPT = `你是苏格拉底，一位伟大的哲学家和导师。你的教学方法是通过提问来引导学生自己发现真理，而不是直接给出答案。

## 核心原则
1. **一次只问一个问题** - 不要连续提出多个问题，每轮回复只能包含一个问句
2. **动态调整深度**：
   - 如果用户回答正确/深入，追问更深入的问题
   - 如果用户回答偏离主题，换个角度重新提问
   - 如果用户表示不懂，给出线索或提示性问题
3. **不要直接总结** - 只有当用户明确说"帮我总结"或点击"总结"按钮时才提供总结
4. **保持苏格拉底式风格** - 温和、好奇、引导性，用问题激发思考
5. **总结模式绝对禁止追问** - 当进入总结模式时，只输出总结内容，不要提出任何问题

## 对话流程
1. 开始时，先了解用户正在阅读的文档，问一个关于文档核心主题的问题
2. 根据用户的回答，判断理解程度，调整下一个问题
3. 持续深入，直到用户真正理解核心概念

## 回答要求
- 像苏格拉底那样对话，使用温和的语气
- 提出的问题要能激发批判性思考
- 当用户说"总结"或"帮我总结"时，才提供简洁的总结
- 不要说教，要引导
- 如果用户正在阅读的是中文文档，请用中文提问和对话
- 如果用户正在阅读的是英文文档，可以用英文或中文对话
- 你的回复将被程序解析校验，请确保问题清晰可辨，问句使用问号结尾

## 开始对话
当用户开始对话时，请根据用户正在阅读的文档内容，提出一个苏格拉底式的引导问题。不要使用固定的模板，要根据实际内容来提问。

你的第一个问题应该：
- 基于文档的核心主题或标题
- 鼓励用户思考文档的主要目的
- 温和而好奇的语气

例如（根据实际内容调整）：
- "我注意到你正在阅读一篇关于[主题]的文章。你觉得这篇文章试图告诉我们什么？"
- "这篇文档的标题是[标题]。在你开始阅读之前，你对这个主题有什么预先的理解吗？"
- "我看到你正在阅读一份[类型]文档。你认为这份文档的核心论点可能是什么？"`

const SOCRATES_GUIDED_PROMPT = `你是苏格拉底，一位伟大的哲学家和导师。在引导模式下，你通过选择题来帮助学生理解文档内容。

## 核心原则
1. **每次只问一个问题** - 不要连续提出多个问题
2. **必须提供选项** - 每个问题必须附带 2-5 个选项，格式严格为：
   A) 选项文本
   B) 选项文本
   C) 选项文本
   每行一个选项，使用大写字母 A-E 加右括号
3. **选项设计要求**：
   - 有且仅有一个最佳答案
   - 干扰项要有迷惑性，基于常见误解
   - 选项文本简洁，不超过 20 字
   - 不要使用"以上都对"或"以上都不对"作为选项
4. **动态调整难度**：
   - 用户选对 → 肯定回答，追问更深入的选择题
   - 用户选错 → 不直接否定，引导思考为什么其他选项更合适，出新选择题
   - 连续答对 → 可以出综合理解题
5. **不要直接总结** - 只有当用户明确说"帮我总结"或点击"总结"按钮时才提供总结
6. **总结模式禁止出选项** - 总结时只输出总结文本

## 对话流程
1. 开始时，基于文档内容出一个关于核心主题的选择题
2. 根据用户的选择，判断理解程度，调整下一个问题
3. 持续深入，直到用户真正理解核心概念

## 回答要求
- 温和的语气，像苏格拉底那样对话
- 你的回复将被程序解析，选项格式必须严格遵循上述约定
- 每个问题后必须紧跟选项，选项与问题之间空一行
- 如果用户正在阅读中文文档，用中文提问
- 如果用户正在阅读英文文档，可以用英文或中文

## 示例输出
这篇文章讨论了递归的核心思想。你认为递归的本质是什么？

A) 函数调用自身
B) 循环的语法糖
C) 分而治之的策略
D) 栈的操作`

const STATUS_UPDATE_PROMPT = `你是一个学习状态分析器。根据以下对话历史，评估用户对文档的理解状态。

请以 JSON 格式输出（不要包含 markdown 代码块标记）：
{
  "currentStage": "当前学习阶段，使用以下之一：初步接触 | 建立框架 | 深入理解 | 融会贯通",
  "mastered": ["已掌握的知识点1", "已掌握的知识点2"],
  "pendingClarification": ["待澄清的问题1", "待澄清的问题2"],
  "evidenceStatus": "对已掌握内容的理解信心：低 | 中 | 高",
  "nextThinkingDirection": "建议用户下一步思考的方向"
}

要求：
- currentStage 必须从四个阶段中选择最匹配的
- mastered 列出用户已展现出理解的知识点
- pendingClarification 列出对话中暴露出的理解盲区
- evidenceStatus 基于用户回答的深度和准确性判断信心等级
- nextThinkingDirection 给出具体的、可操作的思考方向`

const SUMMARY_PROMPT = `你是一个知识文档生成器。请为以下文档内容生成一份精炼的摘要。

要求：
- 摘要应涵盖文档的核心主题、主要论点和关键结论
- 长度控制在 150-300 字
- 语言精炼，避免冗余
- 直接输出摘要文本，不要添加标题或前缀`

const CONCEPTS_CARDS_PROMPT = `你是一个知识文档生成器。请根据以下文档内容和对话历史，提取关键概念并生成知识卡片。

请以 JSON 格式输出（不要包含 markdown 代码块标记）：
{
  "keyConcepts": [
    { "name": "概念名称", "description": "概念简述（1-2句话）" }
  ],
  "knowledgeCards": [
    {
      "concept": "概念名称",
      "explanation": "一句话解释",
      "keyPoints": ["要点1", "要点2", "要点3"]
    }
  ]
}

要求：
- 提取 3-8 个关键概念
- 每个概念都需要对应一张知识卡片
- keyPoints 每张卡片 2-4 条
- 要点应包含：定义、核心特征、典型应用或常见误区
- 结合对话历史中用户已讨论过的内容，优先处理用户关注的概念`

const DOC_STATUS_PROMPT = `你是一个学习状态分析器。根据以下完整的对话历史，生成一份全面的理解状态评估。

请以 JSON 格式输出（不要包含 markdown 代码块标记）：
{
  "currentStage": "当前学习阶段：初步接触 | 建立框架 | 深入理解 | 融会贯通",
  "mastered": ["已掌握的知识点"],
  "pendingClarification": ["待澄清的问题"],
  "evidenceStatus": "理解信心描述（需比自动更新更详细，50-100字）",
  "nextThinkingDirection": "下一步思考方向（需比自动更新更具体，50-100字）"
}

要求：
- 这是知识文档的正式评估，需要比实时跟踪更全面深入
- mastered 应包含所有对话中展现出的理解
- pendingClarification 应包含所有未解决的疑问
- evidenceStatus 需要详细描述对用户理解的信心及依据
- nextThinkingDirection 需要给出具体的、可操作的学习建议`

const EXPORT_PROMPT = `你是一个知识文档编辑器。请将以下知识文档内容润色为一份结构清晰、语言流畅的 Markdown 文档。

要求：
- 使用恰当的 Markdown 格式（标题、列表、引用、粗体等）
- 语言流畅自然，像一篇精心编写的读书笔记
- 保持信息完整性的同时提升可读性
- 在文档末尾添加"学习状态"章节
- 不要添加原文中没有的信息，但可以优化表达方式
- 直接输出 Markdown 文本，不要包含代码块标记`

const parseLLMJson = (text: string): any => {
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

const downloadMarkdown = (content: string, filename?: string) => {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${filename || "知识文档"}.md`
  a.click()
  URL.revokeObjectURL(url)
}

const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const MarkdownMessage = ({ content, isUser }: { content: string; isUser: boolean }) => {
  const renderedHTML = useMemo(() => {
    let html = content

    const codeBlocks: string[] = []
    html = html.replace(/```(\w+)?\s*\n([\s\S]*?)\n```/g, (match, lang, code) => {
      codeBlocks.push(escapeHtml(code))
      return `__CODE_BLOCK_${codeBlocks.length - 1}__`
    })

    const inlineCodes: string[] = []
    html = html.replace(/`([^`]+)`/g, (match, code) => {
      inlineCodes.push(escapeHtml(code))
      return `__INLINE_CODE_${inlineCodes.length - 1}__`
    })

    html = escapeHtml(html)

    html = html.replace(/^#\s+(.+)$/gm, '<h1 class="text-lg font-bold mb-3 mt-4">$1</h1>')
    html = html.replace(/^##\s+(.+)$/gm, '<h2 class="text-base font-bold mb-2 mt-3">$1</h2>')
    html = html.replace(/^###\s+(.+)$/gm, '<h3 class="text-sm font-bold mb-2 mt-2">$1</h3>')

    html = html.replace(/^[-*+]\s+(.+)$/gm, '<li class="text-sm">$1</li>')
    html = html.replace(/(<li.*<\/li>\n?)+/g, '<ul class="list-disc pl-4 mb-2 space-y-1">$&</ul>')

    html = html.replace(/^\d+\.\s+(.+)$/gm, '<li class="text-sm">$1</li>')
    html = html.replace(/(<li.*<\/li>\n?)+/g, (match) => {
      if (match.includes('class="list-disc')) return match
      return `<ol class="list-decimal pl-4 mb-2 space-y-1">${match}</ol>`
    })

    html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold">$1</strong>')
    html = html.replace(/\*(.+?)\*/g, '<em class="italic">$1</em>')

    html = html.replace(/^&gt;\s+(.+)$/gm, (match, text) => {
      return `<blockquote class="border-l-2 pl-3 py-1 my-2 ${isUser ? 'border-white/50' : 'border-gray-300 text-gray-600'}">${text}</blockquote>`
    })

    html = html.replace(/\n\n/g, '</p><p class="mb-2 last:mb-0">')
    html = html.replace(/\n/g, '<br/>')

    if (html && !html.startsWith('<')) {
      html = '<p class="mb-2 last:mb-0">' + html + '</p>'
    }

    html = html.replace(/__INLINE_CODE_(\d+)__/g, (match, index) => {
      const code = inlineCodes[parseInt(index)]
      const bgClass = isUser ? 'bg-white/20' : 'bg-notion-bg-secondary text-notion-text'
      return `<code class="px-1.5 py-0.5 rounded text-xs font-mono ${bgClass}">${code}</code>`
    })

    html = html.replace(/__CODE_BLOCK_(\d+)__/g, (match, index) => {
      const code = codeBlocks[parseInt(index)]
      return `<pre class="my-2"><code class="block px-3 py-2 rounded bg-notion-bg-secondary text-notion-text text-xs font-mono overflow-x-auto">${code}</code></pre>`
    })

    return html
  }, [content, isUser])

  return (
    <div
      className="text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: renderedHTML }}
    />
  )
}

const formatTime = (timestamp: number): string => {
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

const formatDateGroup = (timestamp: number): string => {
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

const extractHostname = (url: string): string => {
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

function SidePanel() {
  const [config] = useStorage<OpenAIConfig>("openai-config", DEFAULT_OPENAI_CONFIG)
  const [pageKey, setPageKey] = useState("")
  const [rounds, setRounds] = useState<ConversationRound[]>([])
  const [activeRoundId, setActiveRoundId] = useState<string | null>(null)
  const [viewingRoundId, setViewingRoundId] = useState<string | null>(null)
  const [showHistoryPanel, setShowHistoryPanel] = useState(false)
  const [allHistoryRounds, setAllHistoryRounds] = useState<ConversationRound[]>([])
  const [editMode, setEditMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmClearAll, setConfirmClearAll] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [streamState, setStreamState] = useState<StreamState>({
    isStreaming: false,
    abortController: null,
  })
  const [hasConfig, setHasConfig] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [contextInvalidated, setContextInvalidated] = useState(false)
  const [pageTitle, setPageTitle] = useState("")
  const [pageUrl, setPageUrl] = useState("")
  const [isLocalFile, setIsLocalFile] = useState(false)
  const [needsFileAccess, setNeedsFileAccess] = useState(false)

  const [showKnowledgePanel, setShowKnowledgePanel] = useState(false)
  const [knowledgeDoc, setKnowledgeDoc] = useState<KnowledgeDocument | null>(null)
  const [isGeneratingDoc, setIsGeneratingDoc] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [understandingStatus, setUnderstandingStatus] = useState<UnderstandingStatus | null>(null)
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false)
  const [showStatusDetail, setShowStatusDetail] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeAbortRef = useRef<AbortController | null>(null)
  const streamAccumulatedRef = useRef("")
  const pageKeyRef = useRef("")
  const statusUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const getPageContentRef = useRef<() => Promise<string>>(null as any)

  useEffect(() => {
    pageKeyRef.current = pageKey
  }, [pageKey])

  useEffect(() => {
    const check = () => {
      try {
        if (typeof chrome !== "undefined" && chrome.runtime && !chrome.runtime.id) {
          setContextInvalidated(true)
        }
      } catch {
        setContextInvalidated(true)
      }
    }
    const interval = setInterval(check, 3000)
    return () => clearInterval(interval)
  }, [])

  const activeRound = useMemo(
    () => rounds.find((r) => r.id === activeRoundId) ?? null,
    [rounds, activeRoundId]
  )

  const viewingRound = useMemo(() => {
    if (viewingRoundId) {
      const found = rounds.find((r) => r.id === viewingRoundId)
      if (found) return found
      const fromAll = allHistoryRounds.find((r) => r.id === viewingRoundId)
      if (fromAll) return fromAll
    }
    return activeRound
  }, [rounds, viewingRoundId, activeRound, allHistoryRounds])

  const messages = useMemo(() => viewingRound?.messages ?? [], [viewingRound])
  const displayMessages = useMemo(() => messages.filter((m) => m.visible), [messages])

  const conversationStarted = !!activeRound
  const isRoundCompleted = viewingRound?.completed ?? false
  const isViewingHistory = viewingRoundId !== null

  const latestIncompleteRound = useMemo(
    () => [...rounds].reverse().find((r) => !r.completed) ?? null,
    [rounds]
  )

  const groupedHistory = useMemo(() => {
    const groups: { label: string; rounds: ConversationRound[] }[] = []
    const groupOrder = ["今天", "昨天", "最近七天", "最近三十天", "更早"]

    for (const round of allHistoryRounds) {
      const label = formatDateGroup(round.updatedAt)
      const existing = groups.find((g) => g.label === label)
      if (existing) {
        existing.rounds.push(round)
      } else {
        groups.push({ label, rounds: [round] })
      }
    }

    groups.sort(
      (a, b) => groupOrder.indexOf(a.label) - groupOrder.indexOf(b.label)
    )

    return groups
  }, [allHistoryRounds])

  useEffect(() => {
    if (config) {
      setHasConfig(!!config.apiKey && !!config.baseURL)
    }
  }, [config])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const generateId = () =>
    Date.now().toString() + Math.random().toString(36).slice(2, 11)

  const getPageContent = async (): Promise<{
    title: string
    content: string
    url: string
    contextPrompt: string
    error?: string
  }> => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (!tab?.id || !tab.url) {
        return { title: "", content: "", url: "", contextPrompt: "", error: "无法获取当前标签页信息" }
      }

      const pageUrl = tab.url

      if (isPdfUrl(pageUrl)) {
        if (isFileUrl(pageUrl)) {
          return await extractLocalPdfContent(tab.id, pageUrl)
        }
        return await extractOnlinePdfContent(tab.id, pageUrl)
      }

      return await extractWebContent(tab.id, pageUrl)
    } catch (error) {
      console.error("Failed to get page content:", error)
      return { title: "", content: "", url: "", contextPrompt: "", error: "页面内容提取失败" }
    }
  }

  const extractOnlinePdfContent = async (tabId: number, url: string) => {
    try {
      const cookies = await getCookiesForUrl(url)
      const result = await extractPdfFromUrl(url, cookies || undefined)

      if (result.success && result.content) {
        const meta: ContentMeta = {
          title: result.title,
          excerpt: result.content.slice(0, 200),
          byline: "",
          siteName: "",
          url,
        }
        const truncatedContent = smartTruncate(result.content, meta)
        const contextPrompt = buildContextPrompt(meta, truncatedContent)

        return {
          title: result.title,
          content: result.content,
          url,
          contextPrompt,
        }
      }

      return await extractPdfViaInjectionFallback(tabId, url, result.error)
    } catch (error) {
      return await extractPdfViaInjectionFallback(tabId, url, error instanceof Error ? error.message : "PDF 提取失败")
    }
  }

  const extractPdfViaInjectionFallback = async (
    tabId: number,
    url: string,
    previousError?: string
  ) => {
    try {
      const result = await extractPdfViaInjection(tabId, url)

      if (result.success && result.content) {
        const meta: ContentMeta = {
          title: result.title,
          excerpt: result.content.slice(0, 200),
          byline: "",
          siteName: "",
          url,
        }
        const truncatedContent = smartTruncate(result.content, meta)
        const contextPrompt = buildContextPrompt(meta, truncatedContent)

        return {
          title: result.title,
          content: result.content,
          url,
          contextPrompt,
        }
      }

      return {
        title: "",
        content: "",
        url,
        contextPrompt: "",
        error: `PDF 内容提取失败：${result.error || previousError || "未知错误"}`,
      }
    } catch {
      return {
        title: "",
        content: "",
        url,
        contextPrompt: "",
        error: `PDF 内容提取失败：${previousError || "未知错误"}`,
      }
    }
  }

  const extractLocalPdfContent = async (tabId: number, url: string) => {
    try {
      const result = await extractPdfViaInjection(tabId, url)

      if (result.success && result.content) {
        const meta: ContentMeta = {
          title: result.title,
          excerpt: result.content.slice(0, 200),
          byline: "",
          siteName: "",
          url,
        }
        const truncatedContent = smartTruncate(result.content, meta)
        const contextPrompt = buildContextPrompt(meta, truncatedContent)

        return {
          title: result.title,
          content: result.content,
          url,
          contextPrompt,
        }
      }
    } catch (error) {
      console.error("Local PDF extraction failed:", error)
    }
    return { title: "", content: "", url: "", contextPrompt: "", error: "本地 PDF 提取失败，请确认已开启文件访问权限" }
  }

  const extractWebContent = async (tabId: number, pageUrl: string) => {
    try {
      const response = await sendTabMessage(tabId, { type: "EXTRACT_CONTENT" })

      if (response?.isPdfViewer) {
        return await extractOnlinePdfContent(tabId, pageUrl)
      }

      if (response?.success && response.content) {
        const meta: ContentMeta = {
          title: response.title || "",
          excerpt: response.excerpt || "",
          byline: response.byline || "",
          siteName: response.siteName || "",
          url: pageUrl,
        }
        const truncatedContent = smartTruncate(response.content, meta)
        const contextPrompt = buildContextPrompt(meta, truncatedContent)

        return {
          title: meta.title,
          content: response.content,
          url: pageUrl,
          contextPrompt,
        }
      }

      if (response?.error === "PAGE_CONTENT_TOO_SHORT") {
        return {
          title: response.title || "",
          content: "",
          url: pageUrl,
          contextPrompt: "",
          error: "页面内容过少，无法提取有效信息。请确认页面已完全加载。",
        }
      }

      if (response && !response.success) {
        return {
          title: response.title || "",
          content: "",
          url: pageUrl,
          contextPrompt: "",
          error: "页面内容提取失败，请确认页面已完全加载后重试。",
        }
      }
    } catch (error) {
      console.warn(
        "Content script not available, falling back to executeScript:",
        error
      )
    }

    return await extractWithScriptInjection(tabId, pageUrl)
  }

  const sendTabMessage = (
    tabId: number,
    message: { type: string }
  ): Promise<any> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Content script timeout"))
      }, 2000)

      try {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          clearTimeout(timeout)
          if (chrome.runtime.lastError) {
            const errMsg = chrome.runtime.lastError.message || ""
            if (
              errMsg.includes("Extension context invalidated") ||
              errMsg.includes("message channel is closed")
            ) {
              setContextInvalidated(true)
              reject(new Error("扩展上下文已失效，请刷新页面后重试"))
            } else {
              reject(new Error(errMsg))
            }
          } else {
            resolve(response)
          }
        })
      } catch {
        clearTimeout(timeout)
        setContextInvalidated(true)
        reject(new Error("扩展上下文已失效，请刷新页面后重试"))
      }
    })
  }

  const extractWithScriptInjection = async (
    tabId: number,
    pageUrl: string,
    skipPdfRedirect: boolean = false
  ) => {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const embedEl = document.querySelector(
            'embed[type="application/pdf"], object[type="application/pdf"]'
          )
          if (embedEl) {
            return { isPdfViewer: true, title: document.title || "", content: "", url: window.location.href }
          }

          const title = document.title || ""
          let content = ""

          const removeSelectors = [
            "script",
            "style",
            "noscript",
            "nav",
            "header",
            "footer",
            "iframe",
            '[role="navigation"]',
            '[role="banner"]',
            '[role="contentinfo"]',
            ".ad",
            ".ads",
            ".sidebar",
            ".comment",
            ".social-share",
            ".cookie-banner",
          ]

          const mainContent = document.querySelector(
            'main, article, [role="main"], .post-content, .article-content, .entry-content, #content'
          )

          const source = mainContent || document.body
          const clone = source.cloneNode(true) as HTMLElement

          removeSelectors.forEach((sel) => {
            try {
              clone.querySelectorAll(sel).forEach((node) => node.remove())
            } catch {}
          })

          content = clone.innerText || document.body.innerText

          return { isPdfViewer: false, title, content, url: window.location.href }
        },
      })

      if (results && results[0]?.result) {
        const result = results[0].result as {
          isPdfViewer: boolean
          title: string
          content: string
          url: string
        }

        if (result.isPdfViewer && !skipPdfRedirect) {
          return await extractOnlinePdfContent(tabId, pageUrl)
        }

        if (result.isPdfViewer && skipPdfRedirect) {
          return {
            title: result.title,
            content: "",
            url: result.url,
            contextPrompt: "",
            error: "PDF 内容提取失败，无法读取该 PDF 文件。",
          }
        }

        if (result.content && result.content.length > 50) {
          const meta: ContentMeta = {
            title: result.title,
            excerpt: result.content.slice(0, 200),
            byline: "",
            siteName: "",
            url: pageUrl,
          }
          const truncatedContent = smartTruncate(result.content, meta)
          const contextPrompt = buildContextPrompt(meta, truncatedContent)

          return {
            title: result.title,
            content: result.content,
            url: result.url,
            contextPrompt,
          }
        }

        return {
          title: result.title,
          content: "",
          url: result.url,
          contextPrompt: "",
          error: "页面内容过少，无法提取有效信息。请确认页面已完全加载。",
        }
      }
    } catch (error) {
      console.error("Script injection fallback failed:", error)
    }
    return { title: "", content: "", url: "", contextPrompt: "", error: "无法提取页面内容，可能是浏览器限制页面" }
  }

  getPageContentRef.current = async (): Promise<string> => {
    const result = await getPageContent()
    return result.contextPrompt || result.content
  }

  const abortCurrentStream = useCallback(() => {
    if (streamState.abortController) {
      streamState.abortController.abort()
      activeAbortRef.current = null
      setStreamState({ isStreaming: false, abortController: null })
    }
    setIsLoading(false)
  }, [streamState.abortController])

  const persistRounds = async (newRounds: ConversationRound[]) => {
    setRounds(newRounds)
    const currentKey = pageKeyRef.current
    if (currentKey) {
      await savePageConversations(currentKey, newRounds)
    }
  }

  const buildConversationContext = useCallback((): string => {
    const round = rounds.find((r) => r.id === activeRoundId)
    if (!round) return ""
    const visibleMessages = round.messages.filter((m) => m.visible)
    if (visibleMessages.length === 0) return ""
    const contextLines = visibleMessages.map(
      (m) => `${m.role === "user" ? "用户" : "苏格拉底"}: ${m.content}`
    )
    return "\n\n--- 对话历史 ---\n" + contextLines.join("\n")
  }, [rounds, activeRoundId])

  const updateUnderstandingStatus = useCallback(async () => {
    const currentKey = pageKeyRef.current
    if (!currentKey || !config.apiKey || !config.baseURL) return
    const round = rounds.find((r) => r.id === activeRoundId)
    if (!round || round.messages.filter((m) => m.visible && m.role === "user").length === 0) return

    setIsUpdatingStatus(true)
    try {
      const conversationContext = buildConversationContext()
      const pageContext = pageTitle ? `\n\n--- 文档信息 ---\n标题: ${pageTitle}\nURL: ${pageUrl}` : ""
      const result = await callLLM(config, [
        { id: "", role: "system", content: STATUS_UPDATE_PROMPT, timestamp: Date.now(), visible: true },
        { id: "", role: "user", content: pageContext + conversationContext, timestamp: Date.now(), visible: true },
      ])
      const parsed = parseLLMJson(result)
      const status: UnderstandingStatus = {
        currentStage: parsed.currentStage || "初步接触",
        mastered: Array.isArray(parsed.mastered) ? parsed.mastered : [],
        pendingClarification: Array.isArray(parsed.pendingClarification) ? parsed.pendingClarification : [],
        evidenceStatus: parsed.evidenceStatus || "低",
        nextThinkingDirection: parsed.nextThinkingDirection || "",
        updatedAt: Date.now(),
      }
      await saveUnderstandingStatus(currentKey, status)
      setUnderstandingStatus(status)
    } catch {
    } finally {
      setIsUpdatingStatus(false)
    }
  }, [config, rounds, activeRoundId, buildConversationContext, pageTitle, pageUrl])

  const scheduleStatusUpdate = useCallback(() => {
    if (statusUpdateTimerRef.current) {
      clearTimeout(statusUpdateTimerRef.current)
    }
    statusUpdateTimerRef.current = setTimeout(() => {
      updateUnderstandingStatus()
    }, 3000)
  }, [updateUnderstandingStatus])

  const generateKnowledgeDocument = useCallback(async () => {
    const currentKey = pageKeyRef.current
    if (!currentKey || !config.apiKey || !config.baseURL) return

    setIsGeneratingDoc(true)
    setShowKnowledgePanel(true)
    try {
      const content = await getPageContentRef.current()
      const conversationContext = buildConversationContext()
      const userContent = content + conversationContext

      const systemMessages = [
        { id: "", role: "system" as const, content: SUMMARY_PROMPT, timestamp: Date.now(), visible: true },
        { id: "", role: "user" as const, content: userContent, timestamp: Date.now(), visible: true },
      ]
      const conceptsMessages = [
        { id: "", role: "system" as const, content: CONCEPTS_CARDS_PROMPT, timestamp: Date.now(), visible: true },
        { id: "", role: "user" as const, content: userContent, timestamp: Date.now(), visible: true },
      ]
      const statusMessages = [
        { id: "", role: "system" as const, content: DOC_STATUS_PROMPT, timestamp: Date.now(), visible: true },
        { id: "", role: "user" as const, content: userContent, timestamp: Date.now(), visible: true },
      ]

      const [summaryResult, conceptsResult, statusResult] = await Promise.allSettled([
        callLLM(config, systemMessages, 2000),
        callLLM(config, conceptsMessages, 4000),
        callLLM(config, statusMessages, 2000),
      ])

      const summary = summaryResult.status === "fulfilled" ? summaryResult.value : "摘要生成失败，请尝试更新"

      let keyConcepts: { name: string; description: string }[] = []
      let knowledgeCards: { concept: string; explanation: string; keyPoints: string[] }[] = []
      if (conceptsResult.status === "fulfilled") {
        try {
          const parsed = parseLLMJson(conceptsResult.value)
          keyConcepts = Array.isArray(parsed.keyConcepts) ? parsed.keyConcepts : []
          knowledgeCards = Array.isArray(parsed.knowledgeCards) ? parsed.knowledgeCards : []
        } catch {}
      }

      let docStatus: UnderstandingStatus = {
        currentStage: "初步接触",
        mastered: [],
        pendingClarification: [],
        evidenceStatus: "低",
        nextThinkingDirection: "",
        updatedAt: Date.now(),
      }
      if (statusResult.status === "fulfilled") {
        try {
          const parsed = parseLLMJson(statusResult.value)
          docStatus = {
            currentStage: parsed.currentStage || "初步接触",
            mastered: Array.isArray(parsed.mastered) ? parsed.mastered : [],
            pendingClarification: Array.isArray(parsed.pendingClarification) ? parsed.pendingClarification : [],
            evidenceStatus: parsed.evidenceStatus || "低",
            nextThinkingDirection: parsed.nextThinkingDirection || "",
            updatedAt: Date.now(),
          }
        } catch {}
      }

      const existingDoc = await loadKnowledgeDocument(currentKey)
      const doc: KnowledgeDocument = {
        pageKey: currentKey,
        summary,
        keyConcepts,
        knowledgeCards,
        understandingStatus: docStatus,
        createdAt: existingDoc?.createdAt || Date.now(),
        updatedAt: Date.now(),
        pageTitle,
        pageUrl,
      }

      await saveKnowledgeDocument(currentKey, doc)
      setKnowledgeDoc(doc)
      await saveUnderstandingStatus(currentKey, docStatus)
      setUnderstandingStatus(docStatus)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "知识文档生成失败")
    } finally {
      setIsGeneratingDoc(false)
    }
  }, [config, pageTitle, pageUrl, buildConversationContext])

  const handleKnowledgeButtonClick = useCallback(async () => {
    if (showKnowledgePanel) {
      setShowKnowledgePanel(false)
      return
    }
    const currentKey = pageKeyRef.current
    if (!currentKey) return
    const existingDoc = await loadKnowledgeDocument(currentKey)
    if (existingDoc) {
      setKnowledgeDoc(existingDoc)
      setShowKnowledgePanel(true)
    } else {
      generateKnowledgeDocument()
    }
  }, [showKnowledgePanel, generateKnowledgeDocument])

  const handleExportMarkdown = useCallback(async () => {
    if (!knowledgeDoc) return
    setIsExporting(true)
    try {
      const rawParts: string[] = []
      rawParts.push(`# ${knowledgeDoc.pageTitle || "知识文档"}\n`)
      rawParts.push(`## 摘要\n${knowledgeDoc.summary}\n`)
      rawParts.push(`## 关键概念\n`)
      for (const c of knowledgeDoc.keyConcepts) {
        rawParts.push(`- **${c.name}**: ${c.description}`)
      }
      rawParts.push(`\n## 知识卡片\n`)
      for (const card of knowledgeDoc.knowledgeCards) {
        rawParts.push(`### ${card.concept}\n${card.explanation}\n`)
        for (const p of card.keyPoints) {
          rawParts.push(`- ${p}`)
        }
        rawParts.push("")
      }
      rawParts.push(`## 学习状态\n`)
      rawParts.push(`- 当前阶段: ${knowledgeDoc.understandingStatus.currentStage}`)
      rawParts.push(`- 已掌握: ${knowledgeDoc.understandingStatus.mastered.join("、")}`)
      rawParts.push(`- 待澄清: ${knowledgeDoc.understandingStatus.pendingClarification.join("、")}`)
      rawParts.push(`- 证据状态: ${knowledgeDoc.understandingStatus.evidenceStatus}`)
      rawParts.push(`- 下一步思考: ${knowledgeDoc.understandingStatus.nextThinkingDirection}`)

      const rawMarkdown = rawParts.join("\n")

      try {
        const polished = await callLLM(config, [
          { id: "", role: "system", content: EXPORT_PROMPT, timestamp: Date.now(), visible: true },
          { id: "", role: "user", content: rawMarkdown, timestamp: Date.now(), visible: true },
        ], 4000)
        downloadMarkdown(polished, knowledgeDoc.pageTitle)
      } catch {
        downloadMarkdown(rawMarkdown, knowledgeDoc.pageTitle)
      }
    } catch {
    } finally {
      setIsExporting(false)
    }
  }, [knowledgeDoc, config])

  const initializeForPage = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab) {
        setPageKey("")
        setRounds([])
        setActiveRoundId(null)
        setViewingRoundId(null)
        setIsLocalFile(false)
        setNeedsFileAccess(false)
        setUnderstandingStatus(null)
        setShowKnowledgePanel(false)
        setKnowledgeDoc(null)
        return
      }

      const tabUrl = tab.url || ""
      const isFile = isFileUrl(tabUrl)
      const isHttp = tabUrl.startsWith("http")

      if (!isFile && !isHttp) {
        const hasFileAccess = await checkFileSchemeAccess()
        if (!hasFileAccess && tabUrl === "") {
          setIsLocalFile(true)
          setNeedsFileAccess(true)
        } else {
          setIsLocalFile(false)
          setNeedsFileAccess(false)
        }
        setPageKey("")
        setRounds([])
        setActiveRoundId(null)
        setViewingRoundId(null)
        setUnderstandingStatus(null)
        setShowKnowledgePanel(false)
        setKnowledgeDoc(null)
        return
      }

      if (isFile) {
        setIsLocalFile(true)
        const hasAccess = await checkFileSchemeAccess()
        setNeedsFileAccess(!hasAccess)
      } else {
        setIsLocalFile(false)
        setNeedsFileAccess(false)
      }

      const key = generatePageKey(tabUrl)

      if (key === pageKeyRef.current) {
        setShowHistoryPanel(false)
        setViewingRoundId(null)
        return
      }

      setPageKey(key)
      setPageUrl(tabUrl)
      setPageTitle(tab.title ?? "")

      const loadedRounds = await loadPageConversations(key)
      setRounds(loadedRounds)

      if (loadedRounds.length > 0) {
        const latestIncomplete = [...loadedRounds]
          .reverse()
          .find((r) => !r.completed)
        if (latestIncomplete) {
          setActiveRoundId(latestIncomplete.id)
        } else {
          setActiveRoundId(loadedRounds[loadedRounds.length - 1].id)
        }
      } else {
        setActiveRoundId(null)
      }

      setViewingRoundId(null)
      setShowHistoryPanel(false)
      setShowKnowledgePanel(false)
      setKnowledgeDoc(null)
      setShowStatusDetail(false)
      setErrorMessage(null)

      const loadedStatus = await loadUnderstandingStatus(key)
      setUnderstandingStatus(loadedStatus)
    } catch (error) {
      console.error("Failed to initialize page:", error)
    }
  }, [])

  useEffect(() => {
    initializeForPage()
  }, [initializeForPage])

  useEffect(() => {
    const handleTabUpdated = (
      _tabId: number,
      changeInfo: { url?: string }
    ) => {
      if (changeInfo.url) {
        if (initTimerRef.current) clearTimeout(initTimerRef.current)
        initTimerRef.current = setTimeout(() => {
          initializeForPage()
        }, 500)
      }
    }

    const handleTabActivated = () => {
      initializeForPage()
    }

    chrome.tabs.onUpdated.addListener(handleTabUpdated)
    chrome.tabs.onActivated.addListener(handleTabActivated)

    return () => {
      chrome.tabs.onUpdated.removeListener(handleTabUpdated)
      chrome.tabs.onActivated.removeListener(handleTabActivated)
      if (initTimerRef.current) clearTimeout(initTimerRef.current)
    }
  }, [initializeForPage])

  const openHistoryPanel = async () => {
    const allRounds = await loadAllConversations()
    setAllHistoryRounds(allRounds)
    setEditMode(false)
    setSelectedIds(new Set())
    setConfirmClearAll(false)
    setDeletingId(null)
    setShowHistoryPanel(true)
    setShowKnowledgePanel(false)
  }

  const refreshHistoryPanel = async () => {
    const allRounds = await loadAllConversations()
    setAllHistoryRounds(allRounds)
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === allHistoryRounds.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allHistoryRounds.map((r) => r.id)))
    }
  }

  const handleDeleteSingle = async (roundId: string) => {
    await deleteConversationRounds([roundId])
    if (activeRoundId === roundId) {
      setActiveRoundId(null)
      setViewingRoundId(null)
    }
    if (viewingRoundId === roundId) {
      setViewingRoundId(null)
    }
    const currentRounds = await loadPageConversations(pageKeyRef.current)
    setRounds(currentRounds)
    await refreshHistoryPanel()
    setDeletingId(null)
  }

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return
    const ids = [...selectedIds]
    await deleteConversationRounds(ids)
    if (ids.includes(activeRoundId ?? "")) {
      setActiveRoundId(null)
      setViewingRoundId(null)
    }
    if (ids.includes(viewingRoundId ?? "")) {
      setViewingRoundId(null)
    }
    const currentRounds = await loadPageConversations(pageKeyRef.current)
    setRounds(currentRounds)
    setSelectedIds(new Set())
    setEditMode(false)
    await refreshHistoryPanel()
  }

  const handleClearAll = async () => {
    await deleteAllConversations()
    setActiveRoundId(null)
    setViewingRoundId(null)
    setRounds([])
    setSelectedIds(new Set())
    setEditMode(false)
    setConfirmClearAll(false)
    await refreshHistoryPanel()
  }

  const exitEditMode = () => {
    setEditMode(false)
    setSelectedIds(new Set())
    setConfirmClearAll(false)
  }

  const startConversation = async (mode: ConversationMode = "free") => {
    if (!hasConfig) {
      chrome.runtime.openOptionsPage()
      return
    }

    if (isLocalFile && needsFileAccess) {
      setErrorMessage("请先开启本地文件访问权限（见下方指引）")
      return
    }

    if (!pageKey) {
      if (isLocalFile && needsFileAccess) {
        setErrorMessage("请先开启本地文件访问权限（见下方指引）")
      } else {
        setErrorMessage("无法识别当前页面，请刷新页面后重试")
      }
      return
    }

    setIsLoading(true)
    setErrorMessage(null)

    try {
      const pageInfo = await getPageContent()

      if (pageInfo.error || !pageInfo.content || pageInfo.content.length < 50) {
        setErrorMessage(pageInfo.error || "无法提取页面内容，请确认页面已完全加载后再试")
        setIsLoading(false)
        return
      }

      let contextPrompt = pageInfo.contextPrompt

      if (!contextPrompt) {
        contextPrompt = "用户正在浏览一个网页。"
        if (pageInfo.title) {
          contextPrompt += `\n\n网页标题：${pageInfo.title}`
        }
        if (pageInfo.url) {
          try {
            const urlObj = new URL(pageInfo.url)
            contextPrompt += `\n网站：${urlObj.hostname}`
          } catch {}
        }
      }

      const roundId = generateId()

      const systemPrompt = mode === "guided" ? SOCRATES_GUIDED_PROMPT : SOCRATES_SYSTEM_PROMPT

      const initialMessage: Message = {
        id: generateId(),
        role: "system",
        content: systemPrompt + "\n\n" + contextPrompt,
        timestamp: Date.now(),
        visible: false
      }

      const firstUserMessage: Message = {
        id: generateId(),
        role: "user",
        content: "我想开始阅读这篇文档，请引导我理解它。",
        timestamp: Date.now(),
        visible: false
      }

      const newRound: ConversationRound = {
        id: roundId,
        pageKey,
        messages: [initialMessage, firstUserMessage],
        completed: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pageTitle: pageInfo.title || pageTitle,
        pageUrl: pageInfo.url || pageUrl,
        conversationMode: mode,
      }

      const newRounds = [...rounds, newRound]
      setRounds(newRounds)
      setActiveRoundId(roundId)
      setViewingRoundId(null)
      if (pageKey) await savePageConversations(pageKey, newRounds)

      const assistantId = generateId()
      const placeholderMessage: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        visible: true,
        isStreaming: true,
      }

      const roundWithPlaceholder: ConversationRound = {
        ...newRound,
        messages: [initialMessage, firstUserMessage, placeholderMessage],
        updatedAt: Date.now(),
      }
      const roundsWithPlaceholder = newRounds.map((r) =>
        r.id === roundId ? roundWithPlaceholder : r
      )
      setRounds(roundsWithPlaceholder)

      const abortController = new AbortController()
      activeAbortRef.current = abortController
      setStreamState({ isStreaming: true, abortController })
      setIsLoading(true)

      streamAccumulatedRef.current = ""
      try {
        const rawText = await callLLMStream(
          config,
          [initialMessage, firstUserMessage],
          (chunk) => {
            streamAccumulatedRef.current += chunk
            const displayContent = extractStreamingDisplay(streamAccumulatedRef.current)
            setRounds((prev) => {
              const updated = prev.map((r) => {
                if (r.id !== roundId) return r
                return {
                  ...r,
                  messages: r.messages.map((m) => {
                    if (m.id !== assistantId) return m
                    return {
                      ...m,
                      content: displayContent,
                    }
                  }),
                }
              })
              return updated
            })
          },
          abortController.signal
        )

        const structured = validateOutput(rawText, "question", mode)
        const finalContent = formatStructuredContent(structured)

        const finalMessage: Message = {
          id: assistantId,
          role: "assistant",
          content: finalContent,
          timestamp: Date.now(),
          visible: true,
          isStreaming: false,
          structuredOutput: structured,
        }

        const updatedRound: ConversationRound = {
          ...newRound,
          messages: [initialMessage, firstUserMessage, finalMessage],
          updatedAt: Date.now(),
        }

        const updatedRounds = newRounds.map((r) =>
          r.id === roundId ? updatedRound : r
        )
        await persistRounds(updatedRounds)
      } catch (error) {
        if (abortController.signal.aborted) {
          const partialMessage: Message = {
            id: assistantId,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            visible: true,
            isStreaming: false,
          }
          const partialRound: ConversationRound = {
            ...newRound,
            messages: [initialMessage, firstUserMessage, partialMessage],
            updatedAt: Date.now(),
          }
          const partialRounds = newRounds.map((r) =>
            r.id === roundId ? partialRound : r
          )
          await persistRounds(partialRounds)
        } else {
          setErrorMessage(
            error instanceof LLMError
              ? error.message
              : error instanceof Error
                ? error.message
                : "未知错误"
          )
        }
      } finally {
        if (activeAbortRef.current === abortController) {
          activeAbortRef.current = null
          setStreamState({ isStreaming: false, abortController: null })
        }
        setIsLoading(false)
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "未知错误"
      )
      setIsLoading(false)
    }
  }

  const handleSend = async (overrideText?: string) => {
    const textToSend = (overrideText || input).trim()
    if (!textToSend || !activeRound) return

    if (streamState.isStreaming) {
      abortCurrentStream()
    }

    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content: textToSend,
      timestamp: Date.now(),
      visible: true
    }

    const shouldComplete = isSummaryRequest(textToSend)
    const currentRound = activeRound
    let messagesAfterUser = [...currentRound.messages, userMessage]
    const roundAfterUser: ConversationRound = {
      ...currentRound,
      messages: messagesAfterUser,
      updatedAt: Date.now(),
    }
    const roundsAfterUser = rounds.map((r) =>
      r.id === currentRound.id ? roundAfterUser : r
    )

    setRounds(roundsAfterUser)
    setInput("")
    setErrorMessage(null)
    if (pageKey) await savePageConversations(pageKey, roundsAfterUser)

    const assistantId = generateId()
    const placeholderMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      visible: true,
      isStreaming: true,
    }

    const roundWithPlaceholder: ConversationRound = {
      ...roundAfterUser,
      messages: [...messagesAfterUser, placeholderMessage],
      updatedAt: Date.now(),
    }
    const roundsWithPlaceholder = roundsAfterUser.map((r) =>
      r.id === currentRound.id ? roundWithPlaceholder : r
    )
    setRounds(roundsWithPlaceholder)

    const abortController = new AbortController()
    activeAbortRef.current = abortController
    setStreamState({ isStreaming: true, abortController })
    setIsLoading(true)

    streamAccumulatedRef.current = ""
    try {
      const compressionResult = await compressMessages(config, messagesAfterUser)
      const messagesForLLM = compressionResult.messages
      if (compressionResult.compressed) {
        messagesAfterUser = compressionResult.messages
      }

      const rawText = await callLLMStream(
        config,
        messagesForLLM,
        (chunk) => {
          streamAccumulatedRef.current += chunk
          const displayContent = extractStreamingDisplay(streamAccumulatedRef.current)
          setRounds((prev) => {
            const updated = prev.map((r) => {
              if (r.id !== currentRound.id) return r
              return {
                ...r,
                messages: r.messages.map((m) => {
                  if (m.id !== assistantId) return m
                  return {
                    ...m,
                    content: displayContent,
                  }
                }),
              }
            })
            return updated
          })
        },
        abortController.signal
      )

      const mode = shouldComplete ? "summary" : "question"
      const structured = validateOutput(rawText, mode, currentRound.conversationMode)
      const finalContent = formatStructuredContent(structured)

      const finalMessage: Message = {
        id: assistantId,
        role: "assistant",
        content: finalContent,
        timestamp: Date.now(),
        visible: true,
        isStreaming: false,
        structuredOutput: structured,
      }

      const messagesAfterAI = [...messagesAfterUser, finalMessage]
      const roundAfterAI: ConversationRound = {
        ...roundAfterUser,
        messages: messagesAfterAI,
        completed: shouldComplete,
        updatedAt: Date.now(),
      }
      const roundsAfterAI = roundsAfterUser.map((r) =>
        r.id === currentRound.id ? roundAfterAI : r
      )
      await persistRounds(roundsAfterAI)
    } catch (error) {
      if (abortController.signal.aborted) {
        const partialMessage: Message = {
          id: assistantId,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          visible: true,
          isStreaming: false,
        }
        const partialRound: ConversationRound = {
          ...roundAfterUser,
          messages: [...messagesAfterUser, partialMessage],
          updatedAt: Date.now(),
        }
        const partialRounds = roundsAfterUser.map((r) =>
          r.id === currentRound.id ? partialRound : r
        )
        await persistRounds(partialRounds)
      } else {
        setErrorMessage(
          error instanceof LLMError
            ? error.message
            : error instanceof Error
              ? error.message
              : "未知错误"
        )
      }
    } finally {
      if (activeAbortRef.current === abortController) {
        activeAbortRef.current = null
        setStreamState({ isStreaming: false, abortController: null })
      }
      setIsLoading(false)
      scheduleStatusUpdate()
    }
  }

  const handleSummarize = async () => {
    if (!activeRound || activeRound.messages.length === 0) return

    if (streamState.isStreaming) {
      abortCurrentStream()
    }

    const userActionMessage: Message = {
      id: generateId(),
      role: "user",
      content: "帮我总结",
      timestamp: Date.now(),
      visible: true
    }

    const internalInstruction: Message = {
      id: generateId(),
      role: "user",
      content: "用户现在希望总结我们的对话和文档的核心内容。请提供一个简洁、清晰的总结，包括：1) 文档的核心主题，2) 我们讨论过的关键点，3) 主要的理解收获。注意：这是总结模式，绝对不要提出任何问题。",
      timestamp: Date.now(),
      visible: false
    }

    const currentRound = activeRound

    const baseCompressionResult = await compressMessages(config, currentRound.messages)
    const baseMessages = baseCompressionResult.compressed
      ? baseCompressionResult.messages
      : currentRound.messages

    let messagesWithUserAction = [...baseMessages, userActionMessage]
    const roundAfterUser: ConversationRound = {
      ...currentRound,
      messages: messagesWithUserAction,
      updatedAt: Date.now(),
    }
    const roundsAfterUser = rounds.map((r) =>
      r.id === currentRound.id ? roundAfterUser : r
    )

    setRounds(roundsAfterUser)
    setErrorMessage(null)
    if (pageKey) await savePageConversations(pageKey, roundsAfterUser)

    const assistantId = generateId()
    const placeholderMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      visible: true,
      isStreaming: true,
    }

    const roundWithPlaceholder: ConversationRound = {
      ...roundAfterUser,
      messages: [...messagesWithUserAction, placeholderMessage],
      updatedAt: Date.now(),
    }
    const roundsWithPlaceholder = roundsAfterUser.map((r) =>
      r.id === currentRound.id ? roundWithPlaceholder : r
    )
    setRounds(roundsWithPlaceholder)

    const abortController = new AbortController()
    activeAbortRef.current = abortController
    setStreamState({ isStreaming: true, abortController })
    setIsLoading(true)

    streamAccumulatedRef.current = ""
    try {
      const messagesWithInstruction = [...baseMessages, userActionMessage, internalInstruction]
      const rawText = await callLLMStream(
        config,
        messagesWithInstruction,
        (chunk) => {
          streamAccumulatedRef.current += chunk
          const displayContent = extractStreamingDisplay(streamAccumulatedRef.current)
          setRounds((prev) => {
            const updated = prev.map((r) => {
              if (r.id !== currentRound.id) return r
              return {
                ...r,
                messages: r.messages.map((m) => {
                  if (m.id !== assistantId) return m
                  return {
                    ...m,
                    content: displayContent,
                  }
                }),
              }
            })
            return updated
          })
        },
        abortController.signal
      )

      const structured = validateOutput(rawText, "summary", currentRound.conversationMode)
      const finalContent = formatStructuredContent(structured)

      const finalMessage: Message = {
        id: assistantId,
        role: "assistant",
        content: finalContent,
        timestamp: Date.now(),
        visible: true,
        isStreaming: false,
        structuredOutput: structured,
      }

      const messagesAfterAI = [...messagesWithUserAction, finalMessage]
      const roundAfterAI: ConversationRound = {
        ...roundAfterUser,
        messages: messagesAfterAI,
        completed: true,
        updatedAt: Date.now(),
      }
      const roundsAfterAI = roundsAfterUser.map((r) =>
        r.id === currentRound.id ? roundAfterAI : r
      )
      await persistRounds(roundsAfterAI)
    } catch (error) {
      if (abortController.signal.aborted) {
        const partialMessage: Message = {
          id: assistantId,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          visible: true,
          isStreaming: false,
        }
        const partialRound: ConversationRound = {
          ...roundAfterUser,
          messages: [...messagesWithUserAction, partialMessage],
          updatedAt: Date.now(),
        }
        const partialRounds = roundsAfterUser.map((r) =>
          r.id === currentRound.id ? partialRound : r
        )
        await persistRounds(partialRounds)
      } else {
        setErrorMessage(
          error instanceof LLMError
            ? error.message
            : error instanceof Error
              ? error.message
              : "未知错误"
        )
      }
    } finally {
      if (activeAbortRef.current === abortController) {
        activeAbortRef.current = null
        setStreamState({ isStreaming: false, abortController: null })
      }
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (!streamState.isStreaming) {
        handleSend()
      }
    }
  }

  const handleNewConversation = () => {
    setViewingRoundId(null)
    setActiveRoundId(null)
    setErrorMessage(null)
    setInput("")
  }

  const handleOpenHistoryRound = async (round: ConversationRound) => {
    if (editMode) return
    if (round.pageKey === pageKeyRef.current) {
      setViewingRoundId(round.id)
      if (!round.completed) {
        setActiveRoundId(round.id)
      }
    } else {
      const loadedRounds = await loadPageConversations(round.pageKey)
      setRounds(loadedRounds)
      setPageKey(round.pageKey)
      setViewingRoundId(round.id)
      if (!round.completed) {
        setActiveRoundId(round.id)
      } else {
        setActiveRoundId(null)
      }
    }
    setShowHistoryPanel(false)
    setErrorMessage(null)
  }

  const handleContinueRound = (roundId: string) => {
    setActiveRoundId(roundId)
    setViewingRoundId(null)
    setErrorMessage(null)
  }

  const handleBackToActive = () => {
    setViewingRoundId(null)
    if (!activeRound) {
      setActiveRoundId(null)
    }
  }

  return (
    <div className="flex flex-col h-full bg-notion-bg text-notion-text transition-colors duration-300">
      {contextInvalidated && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-notion-bg">
          <div className="text-center px-8 max-w-xs">
            <div className="w-12 h-12 mx-auto mb-4 bg-amber-100 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-notion-text mb-2">扩展已更新</h3>
            <p className="text-xs text-notion-text-secondary mb-4">检测到扩展上下文已失效，这通常是因为扩展被重新加载或更新。请刷新页面以恢复功能。</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 bg-notion-accent text-white rounded-xl text-sm font-medium shadow-lg shadow-notion-accent/20 hover:bg-notion-accent-hover transition-all active:scale-95"
            >
              刷新页面
            </button>
          </div>
        </div>
      )}
      <header className="flex items-center justify-between px-4 py-3 border-b border-notion-border bg-notion-bg/80 backdrop-blur-md sticky top-0 z-20 gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 bg-notion-accent rounded-lg flex-shrink-0 flex items-center justify-center shadow-sm shadow-notion-accent/20">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5h8M9 5v14m6-14v14M6 19h12" />
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-tight truncate">苏格拉底</h1>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse flex-shrink-0" />
              <span className="text-[10px] font-medium text-notion-text-secondary truncate">
                {isViewingHistory ? "查看历史对话" : (viewingRound?.conversationMode === "guided" ? "引导模式 · 在线" : "思辨模式 · 在线")}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {conversationStarted && !isViewingHistory && (
            <button
              onClick={handleKnowledgeButtonClick}
              disabled={isGeneratingDoc || streamState.isStreaming}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-30 ${showKnowledgePanel ? "text-notion-accent bg-notion-accent/10" : "text-notion-text-secondary hover:bg-notion-hover"}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <span>知识</span>
            </button>
          )}
          {conversationStarted && activeRound && !activeRound.completed && !isViewingHistory && (
            <button
              onClick={handleSummarize}
              disabled={streamState.isStreaming}
              className="flex items-center gap-1 px-2 py-1.5 text-notion-text-secondary hover:bg-notion-hover rounded-lg text-xs transition-colors disabled:opacity-30"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
              </svg>
              <span>总结</span>
            </button>
          )}
          <button
            onClick={openHistoryPanel}
            className="flex items-center gap-1 px-2 py-1.5 text-notion-text-secondary hover:bg-notion-hover rounded-lg text-xs transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>历史</span>
          </button>
          {conversationStarted && !isViewingHistory && (
            <button
              onClick={handleNewConversation}
              className="flex items-center gap-1 px-2 py-1.5 text-notion-text-secondary hover:bg-notion-hover rounded-lg text-xs transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span>新对话</span>
            </button>
          )}
        </div>
      </header>

      {showKnowledgePanel ? (
        <div className="flex flex-col h-full">
          <div className="sticky top-0 z-10 bg-notion-bg border-b border-notion-border">
            <div className="px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowKnowledgePanel(false)}
                  className="text-notion-text-secondary hover:text-notion-text transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h2 className="text-sm font-bold">知识文档</h2>
              </div>
              <div className="flex items-center gap-1">
                {knowledgeDoc && !isGeneratingDoc && (
                  <>
                    <button
                      onClick={generateKnowledgeDocument}
                      disabled={isGeneratingDoc}
                      className="text-[11px] text-notion-accent hover:text-notion-accent-hover font-medium transition-colors disabled:opacity-50"
                    >
                      更新
                    </button>
                    <span className="text-notion-border">|</span>
                    <button
                      onClick={handleExportMarkdown}
                      disabled={isExporting}
                      className="text-[11px] text-notion-accent hover:text-notion-accent-hover font-medium transition-colors disabled:opacity-50"
                    >
                      {isExporting ? "导出中..." : "导出"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {isGeneratingDoc ? (
              <div className="p-5 space-y-6">
                <div className="animate-pulse">
                  <div className="h-3 bg-notion-bg-secondary rounded w-16 mb-3" />
                  <div className="h-20 bg-notion-bg-secondary rounded-xl" />
                </div>
                <div className="animate-pulse">
                  <div className="h-3 bg-notion-bg-secondary rounded w-20 mb-3" />
                  <div className="flex gap-2 flex-wrap">
                    <div className="h-6 w-16 bg-notion-bg-secondary rounded-full" />
                    <div className="h-6 w-20 bg-notion-bg-secondary rounded-full" />
                    <div className="h-6 w-14 bg-notion-bg-secondary rounded-full" />
                  </div>
                </div>
                <div className="animate-pulse">
                  <div className="h-3 bg-notion-bg-secondary rounded w-16 mb-3" />
                  <div className="space-y-3">
                    <div className="h-24 bg-notion-bg-secondary rounded-xl" />
                    <div className="h-24 bg-notion-bg-secondary rounded-xl" />
                  </div>
                </div>
                <div className="animate-pulse">
                  <div className="h-3 bg-notion-bg-secondary rounded w-16 mb-3" />
                  <div className="h-32 bg-notion-bg-secondary rounded-xl" />
                </div>
              </div>
            ) : knowledgeDoc ? (
              <div className="p-5 space-y-6">
                <div>
                  <h3 className="text-xs font-semibold text-notion-text-secondary uppercase tracking-wider mb-2">摘要</h3>
                  <p className="text-sm text-notion-text leading-relaxed">{knowledgeDoc.summary}</p>
                </div>

                {knowledgeDoc.keyConcepts.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-notion-text-secondary uppercase tracking-wider mb-2">关键概念</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {knowledgeDoc.keyConcepts.map((concept, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center px-2.5 py-1 bg-notion-accent/10 text-notion-accent rounded-full text-xs font-medium"
                        >
                          {concept.name}
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 space-y-2">
                      {knowledgeDoc.keyConcepts.map((concept, idx) => (
                        <div key={idx} className="text-xs text-notion-text-secondary">
                          <span className="font-medium text-notion-text">{concept.name}</span>: {concept.description}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {knowledgeDoc.knowledgeCards.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-notion-text-secondary uppercase tracking-wider mb-2">知识卡片</h3>
                    <div className="space-y-3">
                      {knowledgeDoc.knowledgeCards.map((card, idx) => (
                        <div
                          key={idx}
                          className="p-3 bg-notion-bg-secondary rounded-xl border border-notion-border/30"
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="w-5 h-5 bg-notion-accent/10 rounded flex items-center justify-center flex-shrink-0">
                              <span className="text-[10px] font-bold text-notion-accent">{idx + 1}</span>
                            </div>
                            <span className="text-sm font-semibold text-notion-text">{card.concept}</span>
                          </div>
                          <p className="text-xs text-notion-text-secondary mb-2 pl-7">{card.explanation}</p>
                          {card.keyPoints.length > 0 && (
                            <ul className="space-y-1 pl-7">
                              {card.keyPoints.map((point, pIdx) => (
                                <li key={pIdx} className="text-xs text-notion-text-secondary flex items-start gap-1.5">
                                  <span className="text-notion-accent/60 mt-0.5 flex-shrink-0">·</span>
                                  <span>{point}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="text-xs font-semibold text-notion-text-secondary uppercase tracking-wider mb-2">理解状态</h3>
                  <div className="p-3 bg-notion-bg-secondary rounded-xl border border-notion-border/30 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-notion-accent px-2 py-0.5 bg-notion-accent/10 rounded-full">
                        {knowledgeDoc.understandingStatus.currentStage}
                      </span>
                      {knowledgeDoc.understandingStatus.mastered.length > 0 && (
                        <span className="text-xs text-green-600 dark:text-green-400">✓ {knowledgeDoc.understandingStatus.mastered.length} 已掌握</span>
                      )}
                      {knowledgeDoc.understandingStatus.pendingClarification.length > 0 && (
                        <span className="text-xs text-amber-600 dark:text-amber-400">⚠ {knowledgeDoc.understandingStatus.pendingClarification.length} 待澄清</span>
                      )}
                    </div>
                    <div className="text-xs text-notion-text-secondary">
                      理解信心: {knowledgeDoc.understandingStatus.evidenceStatus}
                    </div>
                    {knowledgeDoc.understandingStatus.nextThinkingDirection && (
                      <div className="text-xs text-notion-text-secondary">
                        💡 {knowledgeDoc.understandingStatus.nextThinkingDirection}
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-center pt-2 pb-4">
                  <span className="text-[10px] text-notion-text-secondary opacity-60">
                    更新于 {formatTime(knowledgeDoc.updatedAt)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
                <svg className="w-12 h-12 text-notion-border mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <p className="text-sm text-notion-text-secondary">暂无知识文档</p>
                <p className="text-xs text-notion-text-secondary mt-1 opacity-60">开始对话后，点击生成知识文档</p>
              </div>
            )}
          </div>
        </div>
      ) : showHistoryPanel ? (
        <div className="flex flex-col h-full">
          <div className="sticky top-0 z-10 bg-notion-bg border-b border-notion-border">
            <div className="px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold">历史对话</h2>
                {allHistoryRounds.length > 0 && !editMode && (
                  <button
                    onClick={() => setEditMode(true)}
                    className="text-[11px] text-notion-accent hover:text-notion-accent-hover font-medium transition-colors"
                  >
                    管理
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1">
                {editMode ? (
                  <>
                    <button
                      onClick={toggleSelectAll}
                      className="text-[11px] text-notion-accent hover:text-notion-accent-hover font-medium px-2 py-1 transition-colors"
                    >
                      {selectedIds.size === allHistoryRounds.length ? "取消全选" : "全选"}
                    </button>
                    <button
                      onClick={exitEditMode}
                      className="text-[11px] text-notion-text-secondary hover:text-notion-text font-medium px-2 py-1 transition-colors"
                    >
                      完成
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setShowHistoryPanel(false)}
                    className="p-1 text-notion-text-secondary hover:bg-notion-hover rounded-lg transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {editMode && selectedIds.size > 0 && (
              <div className="px-4 pb-2 flex items-center gap-2">
                <button
                  onClick={handleDeleteSelected}
                  className="text-[11px] font-medium px-3 py-1.5 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500/20 transition-colors"
                >
                  删除所选 ({selectedIds.size})
                </button>
              </div>
            )}

            {editMode && !confirmClearAll && (
              <div className="px-4 pb-2">
                <button
                  onClick={() => setConfirmClearAll(true)}
                  className="text-[11px] text-notion-text-secondary hover:text-red-500 transition-colors"
                >
                  清空全部对话
                </button>
              </div>
            )}

            {editMode && confirmClearAll && (
              <div className="px-4 pb-2 flex items-center gap-2">
                <span className="text-[11px] text-red-500">确认清空所有对话？</span>
                <button
                  onClick={handleClearAll}
                  className="text-[11px] font-medium px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                >
                  清空
                </button>
                <button
                  onClick={() => setConfirmClearAll(false)}
                  className="text-[11px] text-notion-text-secondary hover:text-notion-text px-2 py-1 transition-colors"
                >
                  取消
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {allHistoryRounds.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
                <svg className="w-12 h-12 text-notion-border mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-notion-text-secondary">暂无历史对话</p>
                <p className="text-xs text-notion-text-secondary mt-1 opacity-60">开始阅读引导后，对话会自动保存在这里</p>
              </div>
            ) : (
              <div className="p-3">
                {groupedHistory.map((group) => (
                  <div key={group.label} className="mb-4">
                    <div className="px-2 py-1.5 mb-1">
                      <span className="text-[11px] font-semibold text-notion-text-secondary uppercase tracking-wider">
                        {group.label}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {group.rounds.map((round) => (
                        <div
                          key={round.id}
                          className={`relative rounded-lg transition-colors ${
                            editMode
                              ? selectedIds.has(round.id)
                                ? "bg-notion-accent/5"
                                : "hover:bg-notion-hover/50"
                              : ""
                          }`}
                        >
                          <button
                            onClick={() => {
                              if (editMode) {
                                toggleSelect(round.id)
                              } else {
                                handleOpenHistoryRound(round)
                              }
                            }}
                            className="w-full px-3 py-2.5 rounded-lg transition-colors text-left hover:bg-notion-hover group"
                          >
                            <div className="flex items-start gap-2.5">
                              {editMode && (
                                <div
                                  className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center mt-1 transition-colors ${
                                    selectedIds.has(round.id)
                                      ? "bg-notion-accent"
                                      : "bg-notion-bg-secondary border border-notion-border"
                                  }`}
                                >
                                  {selectedIds.has(round.id) && (
                                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </div>
                              )}
                              <div className="w-7 h-7 bg-notion-bg-secondary rounded-lg flex-shrink-0 flex items-center justify-center border border-notion-border/50 mt-0.5">
                                <svg className="w-3.5 h-3.5 text-notion-accent/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium truncate">
                                    {round.pageTitle || "未命名页面"}
                                  </span>
                                  {round.completed ? (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400 flex-shrink-0">
                                      已完成
                                    </span>
                                  ) : (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-notion-accent/10 text-notion-accent flex-shrink-0">
                                      进行中
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="text-[10px] text-notion-text-secondary truncate">
                                    {extractHostname(round.pageUrl)}
                                  </span>
                                  <span className="text-[10px] text-notion-text-secondary opacity-40">·</span>
                                  <span className="text-[10px] text-notion-text-secondary flex-shrink-0">
                                    {formatTime(round.updatedAt)}
                                  </span>
                                </div>
                              </div>
                              {!editMode && deletingId !== round.id && (
                                <svg className="w-4 h-4 text-notion-text-secondary opacity-0 group-hover:opacity-50 flex-shrink-0 mt-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              )}
                            </div>
                          </button>

                          {!editMode && (
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                              {deletingId === round.id ? (
                                <div className="flex items-center gap-1 bg-notion-bg rounded-lg shadow-sm border border-notion-border px-1.5 py-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleDeleteSingle(round.id)
                                    }}
                                    className="text-[10px] font-medium text-red-500 hover:text-red-600 px-1.5 py-0.5 transition-colors"
                                  >
                                    删除
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setDeletingId(null)
                                    }}
                                    className="text-[10px] text-notion-text-secondary hover:text-notion-text px-1.5 py-0.5 transition-colors"
                                  >
                                    取消
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setDeletingId(round.id)
                                  }}
                                  className="p-1 text-notion-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                                  title="删除"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {isViewingHistory && (
              <div className="px-4 py-2 bg-notion-bg-secondary border-b border-notion-border flex items-center justify-between">
                <span className="text-xs text-notion-text-secondary">查看历史对话</span>
                <button
                  onClick={handleBackToActive}
                  className="text-xs text-notion-accent hover:text-notion-accent-hover font-medium transition-colors"
                >
                  返回当前
                </button>
              </div>
            )}

            {!conversationStarted && !isViewingHistory ? (
              <div className="flex flex-col items-center justify-center min-h-full px-8 py-12 text-center">
                <div className="w-20 h-20 bg-notion-bg-secondary rounded-2xl flex items-center justify-center mb-8 border border-notion-border/50 relative group">
                  <div className="absolute inset-0 bg-notion-accent opacity-0 group-hover:opacity-5 rounded-2xl transition-opacity" />
                  <svg className="w-10 h-10 text-notion-accent/40 group-hover:text-notion-accent transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold tracking-tight mb-3">苏格拉底</h2>
                <p className="text-sm text-notion-text-secondary leading-relaxed mb-10 opacity-80">
                  通过提问引导你深入理解文档，在思辨中获得真正的洞见。
                </p>

                <div className="flex gap-3 w-full max-w-xs">
                  <button
                    onClick={() => startConversation("free")}
                    disabled={streamState.isStreaming || isLoading}
                    className="flex-1 group relative px-4 py-3 bg-notion-accent text-white rounded-xl font-bold shadow-lg shadow-notion-accent/20 hover:bg-notion-accent-hover transition-all active:scale-95 disabled:opacity-50"
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      <span className="text-xs font-bold">思辨模式</span>
                      <span className="text-[10px] opacity-70 leading-tight">自由回答<br/>深度探讨</span>
                    </div>
                  </button>
                  <button
                    onClick={() => startConversation("guided")}
                    disabled={streamState.isStreaming || isLoading}
                    className="flex-1 group relative px-4 py-3 bg-notion-bg-secondary text-notion-text border border-notion-border rounded-xl font-bold shadow-sm hover:bg-notion-hover transition-all active:scale-95 disabled:opacity-50"
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                      </svg>
                      <span className="text-xs font-bold">引导模式</span>
                      <span className="text-[10px] opacity-60 leading-tight">选择题<br/>循序渐进</span>
                    </div>
                  </button>
                </div>

                {latestIncompleteRound && latestIncompleteRound.id !== activeRoundId && (
                  <button
                    onClick={() => handleContinueRound(latestIncompleteRound.id)}
                    className="mt-3 px-10 py-3 bg-notion-bg-secondary text-notion-text border border-notion-border rounded-xl font-medium hover:bg-notion-hover transition-all"
                  >
                    继续上次对话
                  </button>
                )}

                {!hasConfig && (
                  <p className="mt-8 text-xs text-notion-text-secondary flex items-center gap-1.5 opacity-60">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    需在设置中配置 API 密钥
                  </p>
                )}

                {errorMessage && (
                  <div className="mt-6 w-full max-w-xs mx-auto">
                    <div className="px-4 py-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-xl">
                      <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {errorMessage}
                      </p>
                    </div>
                  </div>
                )}

                {isLocalFile && needsFileAccess && (
                  <div className="mt-6 w-full max-w-xs mx-auto">
                    <div className="px-4 py-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl text-left">
                      <div className="flex items-start gap-2.5">
                        <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <div>
                          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1.5">
                            需要开启本地文件访问权限
                          </p>
                          <p className="text-[11px] text-amber-600 dark:text-amber-400/80 leading-relaxed mb-2.5">
                            要读取本地 PDF 或 HTML 文件，请在扩展管理页面开启"允许访问文件网址"：
                          </p>
                          <ol className="text-[11px] text-amber-600 dark:text-amber-400/80 leading-relaxed space-y-1 mb-3 list-decimal list-inside">
                            <li>点击下方按钮打开扩展管理页</li>
                            <li>找到「苏格拉底式阅读助手」</li>
                            <li>点击「详情」</li>
                            <li>开启「允许访问文件网址」开关</li>
                            <li>刷新当前页面后重新使用</li>
                          </ol>
                          <button
                            onClick={() => chrome.tabs.create({ url: "chrome://extensions/?id=" + chrome.runtime.id })}
                            className="w-full text-[11px] font-semibold px-3 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                          >
                            打开扩展管理页
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-5 space-y-8 pb-32">
                {displayMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}
                  >
                    <div className={`flex gap-3 max-w-[95%] ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                      <div className={`w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center border shadow-sm ${
                        message.role === "assistant" 
                          ? "bg-notion-bg-secondary border-notion-border text-notion-accent" 
                          : "bg-notion-text border-notion-text text-white"
                      }`}>
                        {message.role === "assistant" ? (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5h8M9 5v14m6-14v14" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        )}
                      </div>
                      <div className={`px-4 py-2.5 rounded-2xl ${
                        message.role === "user"
                          ? "bg-notion-accent text-white shadow-md shadow-notion-accent/10"
                          : "bg-notion-bg-secondary text-notion-text border border-notion-border/30 shadow-sm"
                      }`}>
                        <MarkdownMessage
                          content={
                            message.structuredOutput?.options && message.structuredOutput.options.length >= 2
                              ? formatDisplayContent(message.structuredOutput)
                              : message.content
                          }
                          isUser={message.role === "user"}
                        />
                        {message.isStreaming && (
                          <span className="inline-block w-1.5 h-4 bg-notion-accent/70 ml-0.5 animate-[blink_1s_ease-in-out_infinite] align-text-bottom" />
                        )}
                        {!message.isStreaming && message.structuredOutput?.options && message.structuredOutput.options.length >= 2 && !isRoundCompleted && (
                          <div className="mt-3 flex flex-col gap-1.5">
                            {message.structuredOutput.options.map((option, idx) => {
                              const labels = ["A", "B", "C", "D", "E"]
                              return (
                                <button
                                  key={idx}
                                  onClick={() => {
                                    if (!streamState.isStreaming) {
                                      handleSend(option)
                                    }
                                  }}
                                  disabled={streamState.isStreaming}
                                  className="w-full text-left px-3 py-2 rounded-lg border border-notion-border/50 bg-notion-bg hover:bg-notion-hover hover:border-notion-accent/30 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed group/option"
                                >
                                  <span className="text-notion-accent font-medium mr-2 group-hover/option:scale-110 inline-block transition-transform">{labels[idx]})</span>
                                  <span className="text-notion-text">{option}</span>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {isLoading && !streamState.isStreaming && (
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-lg bg-notion-bg-secondary border border-notion-border flex-shrink-0 flex items-center justify-center">
                      <div className="flex gap-1">
                        <div className="w-1 h-1 bg-notion-accent rounded-full animate-[fadeInUp_0.6s_ease-out_infinite]" style={{ animationDelay: "0ms" }} />
                        <div className="w-1 h-1 bg-notion-accent rounded-full animate-[fadeInUp_0.6s_ease-out_infinite]" style={{ animationDelay: "150ms" }} />
                      </div>
                    </div>
                  </div>
                )}
                {errorMessage && (
                  <div className="flex justify-center">
                    <div className="px-4 py-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-xl max-w-xs">
                      <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {errorMessage}
                      </p>
                    </div>
                  </div>
                )}
                {isRoundCompleted && !isViewingHistory && (
                  <div className="flex justify-center py-2">
                    <div className="flex items-center gap-2 px-4 py-2 bg-notion-bg-secondary rounded-xl border border-notion-border/50">
                      <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-xs text-notion-text-secondary">本轮对话已完成</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {conversationStarted && !isRoundCompleted && !isViewingHistory && (
            <div className="border-t border-notion-border bg-notion-bg">
              {understandingStatus && !showKnowledgePanel && (
                <div className="px-4 pt-3">
                  <button
                    onClick={() => setShowStatusDetail(!showStatusDetail)}
                    className="w-full text-left"
                  >
                    <div className="flex items-center gap-2 text-xs text-notion-text-secondary">
                      <span className="font-medium text-notion-accent">{understandingStatus.currentStage}</span>
                      <span className="text-green-600 dark:text-green-400">✓{understandingStatus.mastered.length}</span>
                      <span className="text-amber-600 dark:text-amber-400">⚠{understandingStatus.pendingClarification.length}</span>
                      {isUpdatingStatus && (
                        <svg className="w-3 h-3 animate-spin text-notion-accent" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      )}
                      <svg className={`w-3 h-3 ml-auto transition-transform ${showStatusDetail ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                  <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${showStatusDetail ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                    <div className="overflow-hidden">
                      <div className="pt-2 pb-1 space-y-1.5">
                        {understandingStatus.mastered.length > 0 && (
                          <div>
                            <span className="text-[11px] text-green-600 dark:text-green-400 font-medium">已掌握</span>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {understandingStatus.mastered.map((item, idx) => (
                                <span key={idx} className="text-[10px] px-1.5 py-0.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-full">{item}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {understandingStatus.pendingClarification.length > 0 && (
                          <div>
                            <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">待澄清</span>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {understandingStatus.pendingClarification.map((item, idx) => (
                                <span key={idx} className="text-[10px] px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-full">{item}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="text-[11px] text-notion-text-secondary">
                          理解信心: {understandingStatus.evidenceStatus}
                        </div>
                        {understandingStatus.nextThinkingDirection && (
                          <div className="text-[11px] text-notion-text-secondary">
                            💡 {understandingStatus.nextThinkingDirection}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div className="p-4 pt-2">
              {streamState.isStreaming ? (
                <button
                  onClick={abortCurrentStream}
                  className="w-full px-4 py-2.5 bg-notion-bg-secondary text-notion-text border border-notion-border rounded-xl text-sm font-medium hover:bg-notion-hover transition-all flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                  </svg>
                  停止生成
                </button>
              ) : (
              <div className="relative flex items-end gap-2 bg-notion-bg-secondary rounded-2xl border border-notion-border p-2 focus-within:border-notion-accent/50 focus-within:ring-4 focus-within:ring-notion-accent/5 transition-all">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="回复导师的问题..."
                  rows={1}
                  className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-2 px-3 resize-none min-h-[40px] max-h-32 scrollbar-none"
                  style={{ height: "auto" }}
                  onInput={(e) => {
                    const target = e.target as HTMLTextAreaElement
                    target.style.height = "auto"
                    target.style.height = target.scrollHeight + "px"
                  }}
                />
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim()}
                  className={`p-2 rounded-xl transition-all ${
                    input.trim()
                      ? "bg-notion-accent text-white shadow-lg shadow-notion-accent/20"
                      : "bg-notion-bg text-notion-text-secondary opacity-30"
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
              )}
              </div>
            </div>
          )}

          {conversationStarted && isRoundCompleted && !isViewingHistory && (
            <div className="border-t border-notion-border bg-notion-bg">
              {understandingStatus && !showKnowledgePanel && (
                <div className="px-4 pt-3">
                  <button
                    onClick={() => setShowStatusDetail(!showStatusDetail)}
                    className="w-full text-left"
                  >
                    <div className="flex items-center gap-2 text-xs text-notion-text-secondary">
                      <span className="font-medium text-notion-accent">{understandingStatus.currentStage}</span>
                      <span className="text-green-600 dark:text-green-400">✓{understandingStatus.mastered.length}</span>
                      <span className="text-amber-600 dark:text-amber-400">⚠{understandingStatus.pendingClarification.length}</span>
                      <svg className={`w-3 h-3 ml-auto transition-transform ${showStatusDetail ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                  <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${showStatusDetail ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                    <div className="overflow-hidden">
                      <div className="pt-2 pb-1 space-y-1.5">
                        {understandingStatus.mastered.length > 0 && (
                          <div>
                            <span className="text-[11px] text-green-600 dark:text-green-400 font-medium">已掌握</span>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {understandingStatus.mastered.map((item, idx) => (
                                <span key={idx} className="text-[10px] px-1.5 py-0.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-full">{item}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {understandingStatus.pendingClarification.length > 0 && (
                          <div>
                            <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">待澄清</span>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {understandingStatus.pendingClarification.map((item, idx) => (
                                <span key={idx} className="text-[10px] px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-full">{item}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="text-[11px] text-notion-text-secondary">
                          理解信心: {understandingStatus.evidenceStatus}
                        </div>
                        {understandingStatus.nextThinkingDirection && (
                          <div className="text-[11px] text-notion-text-secondary">
                            💡 {understandingStatus.nextThinkingDirection}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div className="p-4">
              <button
                onClick={handleNewConversation}
                className="w-full px-4 py-3 bg-notion-accent text-white rounded-xl font-bold shadow-lg shadow-notion-accent/20 hover:bg-notion-accent-hover transition-all active:scale-95"
              >
                开启新一轮对话
              </button>
              </div>
            </div>
          )}

          {isViewingHistory && !isRoundCompleted && viewingRound && (
            <div className="p-4 border-t border-notion-border bg-notion-bg">
              <button
                onClick={() => handleContinueRound(viewingRound.id)}
                className="w-full px-4 py-3 bg-notion-accent text-white rounded-xl font-bold shadow-lg shadow-notion-accent/20 hover:bg-notion-accent-hover transition-all active:scale-95"
              >
                继续此轮对话
              </button>
            </div>
          )}

          {isViewingHistory && isRoundCompleted && (
            <div className="p-4 border-t border-notion-border bg-notion-bg">
              <div className="flex items-center justify-center gap-2 py-2">
                <svg className="w-4 h-4 text-notion-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-xs text-notion-text-secondary">此轮对话已完成</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default SidePanel
