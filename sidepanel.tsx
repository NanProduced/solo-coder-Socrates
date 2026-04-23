import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import {
  OpenAIConfig,
  DEFAULT_OPENAI_CONFIG,
  Message,
  ConversationRound,
  generatePageKey,
  isSummaryRequest,
  ConversationMode,
} from "./lib/types"
import {
  loadPageConversations,
  savePageConversations,
  loadAllConversations,
  deleteConversationRounds,
  deleteAllConversations,
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
import {
  callLLMStream,
  type StreamCallback,
  stripThinkTags,
} from "./lib/llm-service"
import "./style.css"

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
      return `<blockquote class="border-l-4 pl-3 py-1 my-2 ${isUser ? 'border-white/50' : 'border-gray-300 text-gray-600'}">${text}</blockquote>`
    })

    html = html.replace(/\n\n/g, '</p><p class="mb-2 last:mb-0">')
    html = html.replace(/\n/g, '<br/>')

    if (html && !html.startsWith('<')) {
      html = '<p class="mb-2 last:mb-0">' + html + '</p>'
    }

    html = html.replace(/__INLINE_CODE_(\d+)__/g, (match, index) => {
      const code = inlineCodes[parseInt(index)]
      const bgClass = isUser ? 'bg-white/20' : 'bg-gray-100 text-gray-800'
      return `<code class="px-1.5 py-0.5 rounded text-xs font-mono ${bgClass}">${code}</code>`
    })

    html = html.replace(/__CODE_BLOCK_(\d+)__/g, (match, index) => {
      const code = codeBlocks[parseInt(index)]
      return `<pre class="my-2"><code class="block px-3 py-2 rounded bg-gray-50 text-gray-800 text-xs font-mono overflow-x-auto">${code}</code></pre>`
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
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState("")
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const [hasConfig, setHasConfig] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pageTitle, setPageTitle] = useState("")
  const [pageUrl, setPageUrl] = useState("")
  const [isLocalFile, setIsLocalFile] = useState(false)
  const [needsFileAccess, setNeedsFileAccess] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pageKeyRef = useRef("")

  useEffect(() => {
    pageKeyRef.current = pageKey
  }, [pageKey])

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
  }, [messages, streamingContent])

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

  const callLLMWithStream = async (
    msgs: Message[],
    mode: ConversationMode
  ): Promise<string> => {
    const streamId = generateId()
    setStreamingMessageId(streamId)
    setStreamingContent("")
    setIsStreaming(true)

    const onStream: StreamCallback = (chunk) => {
      if (!chunk.done && chunk.content) {
        setStreamingContent((prev) => prev + chunk.content)
      }
    }

    try {
      const response = await callLLMStream(config, msgs, { mode }, onStream)

      if (!response.validation.passed && response.validation.issues.length > 0) {
        console.warn("LLM响应验证警告:", response.validation.issues)
      }

      return response.content
    } finally {
      setIsStreaming(false)
      setStreamingContent("")
      setStreamingMessageId(null)
    }
  }

  const persistRounds = async (newRounds: ConversationRound[]) => {
    setRounds(newRounds)
    const currentKey = pageKeyRef.current
    if (currentKey) {
      await savePageConversations(currentKey, newRounds)
    }
  }

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
      setErrorMessage(null)
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

  const startConversation = async () => {
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

      const initialMessage: Message = {
        id: generateId(),
        role: "system",
        content: contextPrompt,
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
      }

      const newRounds = [...rounds, newRound]
      setRounds(newRounds)
      setActiveRoundId(roundId)
      setViewingRoundId(null)
      if (pageKey) await savePageConversations(pageKey, newRounds)

      const aiResponse = await callLLMWithStream([initialMessage, firstUserMessage], "single_question")

      const assistantMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: aiResponse,
        timestamp: Date.now(),
        visible: true
      }

      const updatedRound: ConversationRound = {
        ...newRound,
        messages: [initialMessage, firstUserMessage, assistantMessage],
        updatedAt: Date.now(),
      }

      const updatedRounds = newRounds.map((r) =>
        r.id === roundId ? updatedRound : r
      )
      await persistRounds(updatedRounds)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "未知错误")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSend = async () => {
    if (!input.trim() || isLoading || !activeRound) return

    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
      visible: true
    }

    const isSummary = isSummaryRequest(input.trim())
    const mode: ConversationMode = isSummary ? "summary" : "single_question"
    const shouldComplete = isSummary
    const currentRound = activeRound
    const messagesAfterUser = [...currentRound.messages, userMessage]
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
    setIsLoading(true)
    setErrorMessage(null)
    if (pageKey) await savePageConversations(pageKey, roundsAfterUser)

    try {
      const response = await callLLMWithStream(messagesAfterUser, mode)
      const assistantMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: response,
        timestamp: Date.now(),
        visible: true
      }

      const messagesAfterAI = [...messagesAfterUser, assistantMessage]
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
      setErrorMessage(error instanceof Error ? error.message : "未知错误")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSummarize = async () => {
    if (isLoading || !activeRound || activeRound.messages.length === 0) return

    const userActionMessage: Message = {
      id: generateId(),
      role: "user",
      content: "帮我总结",
      timestamp: Date.now(),
      visible: true
    }

    const currentRound = activeRound
    const messagesWithUserAction = [...currentRound.messages, userActionMessage]
    const roundAfterUser: ConversationRound = {
      ...currentRound,
      messages: messagesWithUserAction,
      updatedAt: Date.now(),
    }
    const roundsAfterUser = rounds.map((r) =>
      r.id === currentRound.id ? roundAfterUser : r
    )

    setRounds(roundsAfterUser)
    setIsLoading(true)
    setErrorMessage(null)
    if (pageKey) await savePageConversations(pageKey, roundsAfterUser)

    try {
      const response = await callLLMWithStream(messagesWithUserAction, "summary")
      const assistantMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: response,
        timestamp: Date.now(),
        visible: true
      }

      const messagesAfterAI = [...messagesWithUserAction, assistantMessage]
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
      setErrorMessage(error instanceof Error ? error.message : "未知错误")
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
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
                {isViewingHistory ? "查看历史对话" : "在线思辨中"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {conversationStarted && activeRound && !activeRound.completed && !isViewingHistory && (
            <button
              onClick={handleSummarize}
              disabled={isLoading}
              className="p-1.5 text-notion-text-secondary hover:bg-notion-hover rounded-lg transition-colors disabled:opacity-30"
              title="总结当前对话"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            </button>
          )}
          <button
            onClick={openHistoryPanel}
            className="p-1.5 text-notion-text-secondary hover:bg-notion-hover rounded-lg transition-colors"
            title="历史对话"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          {conversationStarted && !isViewingHistory && (
            <button
              onClick={handleNewConversation}
              className="p-1.5 text-notion-text-secondary hover:bg-red-500/10 hover:text-red-500 rounded-lg transition-colors"
              title="开启新对话"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {showHistoryPanel ? (
        <div className="flex flex-col h-full">
          <div className="sticky top-0 z-10 bg-notion-bg/95 backdrop-blur-md border-b border-notion-border">
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
                <h2 className="text-xl font-bold tracking-tight mb-3">不审视的人生不值得过</h2>
                <p className="text-sm text-notion-text-secondary leading-relaxed mb-10 opacity-80">
                  导师苏格拉底已准备好引导你深入理解此文档。他不会直接给你答案，但会启发你的智慧。
                </p>

                <button
                  onClick={startConversation}
                  disabled={isLoading}
                  className="group relative px-10 py-3 bg-notion-accent text-white rounded-xl font-bold shadow-lg shadow-notion-accent/20 hover:bg-notion-accent-hover transition-all active:scale-95 disabled:opacity-50"
                >
                  {isLoading ? "正在读取心智..." : "开始阅读引导"}
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-notion-bg" />
                </button>

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
                        <MarkdownMessage content={message.content} isUser={message.role === "user"} />
                      </div>
                    </div>
                  </div>
                ))}
                {isStreaming && streamingContent && (
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-lg bg-notion-bg-secondary border border-notion-border flex-shrink-0 flex items-center justify-center">
                      <svg className="w-4 h-4 text-notion-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5h8M9 5v14m6-14v14" />
                      </svg>
                    </div>
                    <div className="max-w-[95%] px-4 py-2.5 rounded-2xl bg-notion-bg-secondary text-notion-text border border-notion-border/30 shadow-sm">
                      <MarkdownMessage content={streamingContent} isUser={false} />
                    </div>
                  </div>
                )}
                {isLoading && !isStreaming && (
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-lg bg-notion-bg-secondary border border-notion-border flex-shrink-0 flex items-center justify-center">
                      <div className="flex gap-1">
                        <div className="w-1 h-1 bg-notion-accent rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <div className="w-1 h-1 bg-notion-accent rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
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
            <div className="p-4 border-t border-notion-border bg-notion-bg/95 backdrop-blur-sm">
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
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className={`p-2 rounded-xl transition-all ${
                    input.trim() && !isLoading
                      ? "bg-notion-accent text-white shadow-lg shadow-notion-accent/20"
                      : "bg-notion-bg text-notion-text-secondary opacity-30"
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {conversationStarted && isRoundCompleted && !isViewingHistory && (
            <div className="p-4 border-t border-notion-border bg-notion-bg/95 backdrop-blur-sm">
              <button
                onClick={handleNewConversation}
                className="w-full px-4 py-3 bg-notion-accent text-white rounded-xl font-bold shadow-lg shadow-notion-accent/20 hover:bg-notion-accent-hover transition-all active:scale-95"
              >
                开启新一轮对话
              </button>
            </div>
          )}

          {isViewingHistory && !isRoundCompleted && viewingRound && (
            <div className="p-4 border-t border-notion-border bg-notion-bg/95 backdrop-blur-sm">
              <button
                onClick={() => handleContinueRound(viewingRound.id)}
                className="w-full px-4 py-3 bg-notion-accent text-white rounded-xl font-bold shadow-lg shadow-notion-accent/20 hover:bg-notion-accent-hover transition-all active:scale-95"
              >
                继续此轮对话
              </button>
            </div>
          )}

          {isViewingHistory && isRoundCompleted && (
            <div className="p-4 border-t border-notion-border bg-notion-bg/95 backdrop-blur-sm">
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
