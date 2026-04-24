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
  CrossDocAnalysis,
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
  loadAllKnowledgeDocuments,
  deleteKnowledgeDocuments,
} from "./lib/storage"
import { KnowledgePanel } from "./components/KnowledgePanel"
import { KnowledgeLibraryPanel } from "./components/KnowledgeLibraryPanel"
import { MarkdownMessage } from "./components/MarkdownMessage"
import { UnderstandingStatusBar } from "./components/UnderstandingStatusBar"
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
  validateOutput,
  extractStreamingDisplay,
  formatStructuredContent,
  formatDisplayContent,
} from "./lib/output-contract"
import {
  COMPRESS_PROMPT,
  shouldCompress,
  buildCompressedMessages,
  getCompressedBeforeMessageId,
  getCompressedRoundCount,
} from "./lib/context-compress"
import {
  SOCRATES_SYSTEM_PROMPT,
  SOCRATES_GUIDED_PROMPT,
  STATUS_UPDATE_PROMPT,
  SUMMARY_PROMPT,
  CONCEPTS_CARDS_PROMPT,
  DOC_STATUS_PROMPT,
  EXPORT_PROMPT,
} from "./lib/prompts"
import {
  parseLLMJson,
  downloadMarkdown,
  formatTime,
  formatDateGroup,
  extractHostname,
} from "./lib/utils"
import "./style.css"

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
  const [showCompressedDetail, setShowCompressedDetail] = useState(false)

  const [knowledgeTab, setKnowledgeTab] = useState<"detail" | "library">("detail")
  const [allKnowledgeDocs, setAllKnowledgeDocs] = useState<KnowledgeDocument[]>([])
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false)
  const [crossDocAnalysis, setCrossDocAnalysis] = useState<CrossDocAnalysis | null>(null)
  const [isAnalyzingRelations, setIsAnalyzingRelations] = useState(false)
  const [isExportingAll, setIsExportingAll] = useState(false)
  const [libraryDocKey, setLibraryDocKey] = useState<string | null>(null)

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

    if (round.compressedSummary && round.compressedBeforeMessageId) {
      const boundaryIndex = visibleMessages.findIndex((m) => m.id === round.compressedBeforeMessageId)
      const recentMessages = boundaryIndex >= 0 ? visibleMessages.slice(boundaryIndex) : visibleMessages
      const contextLines = recentMessages.map(
        (m) => `${m.role === "user" ? "用户" : "苏格拉底"}: ${m.content}`
      )
      return "\n\n--- 对话历史（含早期摘要） ---\n[早期摘要]: " + round.compressedSummary + "\n" + contextLines.join("\n")
    }

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
      // 状态更新失败不影响主流程，静默处理
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

  const compressContext = useCallback(async (round: ConversationRound): Promise<ConversationRound> => {
    const boundaryId = getCompressedBeforeMessageId(round)
    if (!boundaryId) return round

    const visibleMessages = round.messages.filter((m) => m.visible)
    const boundaryIndex = visibleMessages.findIndex((m) => m.id === boundaryId)
    const messagesToCompress = visibleMessages.slice(0, boundaryIndex)

    if (messagesToCompress.length === 0) return round

    try {
      const conversationText = messagesToCompress
        .map((m) => `${m.role === "user" ? "用户" : "苏格拉底"}: ${m.content}`)
        .join("\n")

      const existingSummary = round.compressedSummary
        ? `已有摘要：\n${round.compressedSummary}\n\n新增对话：\n`
        : ""

      const summary = await callLLM(config, [
        { id: "", role: "system", content: COMPRESS_PROMPT, timestamp: Date.now(), visible: false },
        { id: "", role: "user", content: existingSummary + conversationText, timestamp: Date.now(), visible: false },
      ], 1000)

      const updatedRound: ConversationRound = {
        ...round,
        compressedSummary: summary,
        compressedBeforeMessageId: boundaryId,
      }

      setRounds((prev) => {
        const updated = prev.map((r) =>
          r.id === round.id ? { ...r, compressedSummary: summary, compressedBeforeMessageId: boundaryId } : r
        )
        const currentKey = pageKeyRef.current
        if (currentKey) {
          savePageConversations(currentKey, updated)
        }
        return updated
      })
      return updatedRound
    } catch {
      return round
    }
  }, [config])

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
      setKnowledgeTab("detail")
      setShowKnowledgePanel(true)
    } else {
      setKnowledgeTab("library")
      setShowKnowledgePanel(true)
      setIsLoadingLibrary(true)
      try {
        const docs = await loadAllKnowledgeDocuments()
        setAllKnowledgeDocs(docs)
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "加载知识库失败")
      } finally {
        setIsLoadingLibrary(false)
      }
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
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "导出失败")
    } finally {
      setIsExporting(false)
    }
  }, [knowledgeDoc, config])

  const loadAllDocs = useCallback(async () => {
    setIsLoadingLibrary(true)
    try {
      const docs = await loadAllKnowledgeDocuments()
      setAllKnowledgeDocs(docs)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "加载知识库失败")
    } finally {
      setIsLoadingLibrary(false)
    }
  }, [])

  const handleOpenLibraryDoc = useCallback(async (pageKey: string) => {
    const doc = await loadKnowledgeDocument(pageKey)
    if (doc) {
      setKnowledgeDoc(doc)
      setLibraryDocKey(pageKey)
      setKnowledgeTab("detail")
    }
  }, [])

  const handleBackToLibrary = useCallback(() => {
    setLibraryDocKey(null)
    setKnowledgeTab("library")
    loadAllDocs()
  }, [loadAllDocs])

  const handleDeleteDocs = useCallback(async (pageKeys: string[]) => {
    try {
      await deleteKnowledgeDocuments(pageKeys)
      setAllKnowledgeDocs((prev) => prev.filter((d) => !pageKeys.includes(d.pageKey)))
      setCrossDocAnalysis(null)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "删除文档失败")
    }
  }, [])

  const handleExportAllDocs = useCallback(async () => {
    if (allKnowledgeDocs.length === 0) return
    setIsExportingAll(true)
    try {
      const allParts: string[] = []
      for (const doc of allKnowledgeDocs) {
        allParts.push(`# ${doc.pageTitle || "知识文档"}\n`)
        allParts.push(`> 来源: ${doc.pageUrl}\n`)
        allParts.push(`## 摘要\n${doc.summary}\n`)
        allParts.push(`## 关键概念\n`)
        for (const c of doc.keyConcepts) {
          allParts.push(`- **${c.name}**: ${c.description}`)
        }
        allParts.push(`\n## 知识卡片\n`)
        for (const card of doc.knowledgeCards) {
          allParts.push(`### ${card.concept}\n${card.explanation}\n`)
          for (const p of card.keyPoints) {
            allParts.push(`- ${p}`)
          }
          allParts.push("")
        }
        allParts.push(`## 学习状态\n`)
        allParts.push(`- 当前阶段: ${doc.understandingStatus.currentStage}`)
        allParts.push(`- 已掌握: ${doc.understandingStatus.mastered.join("、")}`)
        allParts.push(`- 待澄清: ${doc.understandingStatus.pendingClarification.join("、")}`)
        allParts.push(`- 证据状态: ${doc.understandingStatus.evidenceStatus}`)
        allParts.push(`- 下一步思考: ${doc.understandingStatus.nextThinkingDirection}`)
        allParts.push("\n---\n")
      }

      const rawMarkdown = allParts.join("\n")
      const dateStr = new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")

      try {
        const polished = await callLLM(config, [
          { id: "", role: "system", content: EXPORT_PROMPT, timestamp: Date.now(), visible: true },
          { id: "", role: "user", content: rawMarkdown, timestamp: Date.now(), visible: true },
        ], 8000)
        downloadMarkdown(polished, `知识库总览_${dateStr}`)
      } catch {
        downloadMarkdown(rawMarkdown, `知识库总览_${dateStr}`)
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "导出失败")
    } finally {
      setIsExportingAll(false)
    }
  }, [allKnowledgeDocs, config])

  const handleAnalyzeRelations = useCallback(async () => {
    if (allKnowledgeDocs.length < 2) return
    setIsAnalyzingRelations(true)
    try {
      const docConcepts = allKnowledgeDocs.map((doc) => {
        const concepts = doc.keyConcepts.map((c) => c.name)
        return `文档"${doc.pageTitle}"的概念: [${concepts.join(", ")}]`
      }).join("\n")

      const prompt = `你是一个知识关联分析专家。以下是来自不同文档的知识概念列表，请分析它们之间的关联关系。

${docConcepts}

请分析：
1. 哪些概念在不同文档中重复出现或相互补充？
2. 建议的学习路径顺序是什么？
3. 有哪些概念之间存在依赖关系？

以 JSON 格式输出（不要包含代码块标记）：
{
  "relations": [
    { "conceptName": "概念名", "docPageKeys": ["${allKnowledgeDocs[0]?.pageKey || ""}"], "relationType": "shared", "description": "关联描述" }
  ],
  "suggestedPath": ["文档1标题", "文档2标题"],
  "summary": "整体关联摘要"
}

relationType 只能是 "shared"（共同概念）、"complementary"（互补）、"dependency"（依赖）之一。
docPageKeys 必须是以下值之一: ${allKnowledgeDocs.map((d) => `"${d.pageKey}"`).join(", ")}
suggestedPath 使用文档标题。`

      const result = await callLLM(config, [
        { id: "", role: "system", content: prompt, timestamp: Date.now(), visible: true },
        { id: "", role: "user", content: "请分析以上文档之间的知识关联。", timestamp: Date.now(), visible: true },
      ], 4000)

      const analysis = parseLLMJson(result) as CrossDocAnalysis
      setCrossDocAnalysis(analysis)
    } catch (err) {
      setCrossDocAnalysis(null)
      setErrorMessage(err instanceof Error ? err.message : "关联分析失败")
    } finally {
      setIsAnalyzingRelations(false)
    }
  }, [allKnowledgeDocs, config])

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
        setKnowledgeTab("detail")
        setLibraryDocKey(null)
        setAllKnowledgeDocs([])
        setCrossDocAnalysis(null)
        setShowStatusDetail(false)
        setShowCompressedDetail(false)
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
        setKnowledgeTab("detail")
        setLibraryDocKey(null)
        setAllKnowledgeDocs([])
        setCrossDocAnalysis(null)
        setShowStatusDetail(false)
        setShowCompressedDetail(false)
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
      setKnowledgeTab("detail")
      setLibraryDocKey(null)
      setAllKnowledgeDocs([])
      setCrossDocAnalysis(null)
      setShowStatusDetail(false)
      setShowCompressedDetail(false)
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
    setKnowledgeTab("detail")
    setLibraryDocKey(null)
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
      let roundForLLM = { ...roundAfterUser, messages: messagesAfterUser }
      if (shouldCompress(roundForLLM)) {
        const compressed = await compressContext(roundForLLM)
        roundForLLM = compressed
      }
      const messagesForLLM = buildCompressedMessages(roundForLLM)
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
      const roundWithInstruction = { ...currentRound, messages: [...currentRound.messages, internalInstruction] }
      const messagesForAI = buildCompressedMessages(roundWithInstruction)
      const rawText = await callLLMStream(
        config,
        messagesForAI,
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
        <div className="flex items-center gap-0.5 flex-shrink-0 overflow-x-auto">
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
                  onClick={() => {
                    setShowKnowledgePanel(false)
                    setLibraryDocKey(null)
                  }}
                  className="text-notion-text-secondary hover:text-notion-text transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setKnowledgeTab("detail")
                      setLibraryDocKey(null)
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      knowledgeTab === "detail"
                        ? "text-notion-accent bg-notion-accent/10"
                        : "text-notion-text-secondary hover:bg-notion-hover"
                    }`}
                  >
                    当前文档
                  </button>
                  <button
                    onClick={() => {
                      setKnowledgeTab("library")
                      loadAllDocs()
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      knowledgeTab === "library"
                        ? "text-notion-accent bg-notion-accent/10"
                        : "text-notion-text-secondary hover:bg-notion-hover"
                    }`}
                  >
                    📚 知识库
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {knowledgeTab === "detail" && knowledgeDoc && !isGeneratingDoc && !libraryDocKey && (
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

          {knowledgeTab === "detail" ? (
            <KnowledgePanel
              knowledgeDoc={knowledgeDoc}
              isGeneratingDoc={isGeneratingDoc}
              isExporting={isExporting}
              onClose={() => setShowKnowledgePanel(false)}
              onUpdate={generateKnowledgeDocument}
              onExport={handleExportMarkdown}
              onBackToLibrary={libraryDocKey ? handleBackToLibrary : undefined}
            />
          ) : (
            <KnowledgeLibraryPanel
              allDocs={allKnowledgeDocs}
              isLoading={isLoadingLibrary}
              onOpenDoc={handleOpenLibraryDoc}
              onDeleteDocs={handleDeleteDocs}
              onExportAll={handleExportAllDocs}
              onAnalyzeRelations={handleAnalyzeRelations}
              crossDocAnalysis={crossDocAnalysis}
              isAnalyzing={isAnalyzingRelations}
              isExporting={isExportingAll}
            />
          )}
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
                {viewingRound?.compressedSummary && viewingRound?.compressedBeforeMessageId && (
                  <div className="mb-2">
                    <button
                      onClick={() => setShowCompressedDetail(!showCompressedDetail)}
                      className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-notion-text-secondary bg-notion-bg-secondary rounded-lg border border-notion-border/30 hover:bg-notion-hover transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                      <span>已压缩前 {getCompressedRoundCount(viewingRound)} 轮对话</span>
                      <svg className={`w-3 h-3 ml-auto transition-transform ${showCompressedDetail ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${showCompressedDetail ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                      <div className="overflow-hidden">
                        <div className="mt-1.5 px-3 py-2 text-xs text-notion-text-secondary bg-notion-bg-secondary/50 rounded-lg border border-notion-border/20 leading-relaxed">
                          {viewingRound.compressedSummary}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
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
                <UnderstandingStatusBar
                  understandingStatus={understandingStatus}
                  showStatusDetail={showStatusDetail}
                  onToggleDetail={() => setShowStatusDetail(!showStatusDetail)}
                  isUpdatingStatus={isUpdatingStatus}
                />
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
                <UnderstandingStatusBar
                  understandingStatus={understandingStatus}
                  showStatusDetail={showStatusDetail}
                  onToggleDetail={() => setShowStatusDetail(!showStatusDetail)}
                  isUpdatingStatus={false}
                />
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
