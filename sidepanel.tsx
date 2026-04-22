import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import {
  OpenAIConfig,
  DEFAULT_OPENAI_CONFIG,
  Message,
  ConversationRound,
  generatePageKey,
  isSummaryRequest,
  ExtractedContent,
} from "./lib/types"
import {
  loadPageConversations,
  savePageConversations,
  loadAllConversations,
  deleteConversationRounds,
  deleteAllConversations,
} from "./lib/storage"
import "./style.css"

const SOCRATES_SYSTEM_PROMPT = `你是苏格拉底，一位伟大的哲学家和导师。你的教学方法是通过提问来引导学生自己发现真理，而不是直接给出答案。

## 核心原则
1. **一次只问一个问题** - 不要连续提出多个问题
2. **动态调整深度**：
   - 如果用户回答正确/深入，追问更深入的问题
   - 如果用户回答偏离主题，换个角度重新提问
   - 如果用户表示不懂，给出线索或提示性问题
3. **不要直接总结** - 只有当用户明确说"帮我总结"或点击"总结"按钮时才提供总结
4. **保持苏格拉底式风格** - 温和、好奇、引导性，用问题激发思考

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

const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const stripThinkTags = (content: string): string => {
  return content
    .replace(/<think[\s\S]*?<\/think>/g, "")
    .replace(/<think[\s\S]*$/g, "")
    .trim()
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
    return new URL(url).hostname
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
  const [hasConfig, setHasConfig] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pageTitle, setPageTitle] = useState("")
  const [pageUrl, setPageUrl] = useState("")

  // 新增状态：用于用户体验改进
  const [isExtractingContent, setIsExtractingContent] = useState(false)
  const [showFilePermissionGuide, setShowFilePermissionGuide] = useState(false)
  const [isLocalFile, setIsLocalFile] = useState(false)
  const [extractionProgress, setExtractionProgress] = useState<string>("")

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
  }, [messages])

  const generateId = () =>
    Date.now().toString() + Math.random().toString(36).slice(2, 11)

  // 智能文本截断配置
  const TRUNCATION_CONFIG = {
    maxContextTokens: 128000,
    reservedTokens: 2000,
    titleTokenWeight: 2,
    charToTokenRatio: 0.5,
    minParagraphs: 3,
    maxSummaryTokens: 500,
  }

  // 估算文本的 token 数量
  const estimateTokens = (text: string): number => {
    return Math.ceil(text.length * 0.8)
  }

  // 段落信息接口
  interface ParagraphInfo {
    text: string
    length: number
    tokenEstimate: number
    isHeading: boolean
    position: number
  }

  // 从文本中提取段落信息
  const extractParagraphs = (text: string): ParagraphInfo[] => {
    const lines = text.split(/\n\n+/)
    const paragraphs: ParagraphInfo[] = []

    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (trimmed.length === 0) return

      const isHeading = 
        trimmed.length < 100 && 
        (trimmed === trimmed.toUpperCase() || 
         /^\d+[\.\)]/.test(trimmed) ||
         /^[一二三四五六七八九十]+[、\.]/.test(trimmed))

      paragraphs.push({
        text: trimmed,
        length: trimmed.length,
        tokenEstimate: estimateTokens(trimmed),
        isHeading,
        position: index / lines.length,
      })
    })

    return paragraphs
  }

  // 智能截断文本
  const smartTruncate = (
    title: string,
    content: string,
    maxTokens: number = TRUNCATION_CONFIG.maxContextTokens - TRUNCATION_CONFIG.reservedTokens
  ) => {
    const totalTokens = estimateTokens(title) + estimateTokens(content)

    if (totalTokens <= maxTokens) {
      return {
        truncatedContent: content,
        isTruncated: false,
        totalLength: content.length,
        truncatedLength: content.length,
      }
    }

    const paragraphs = extractParagraphs(content)
    const titleTokens = estimateTokens(title) * TRUNCATION_CONFIG.titleTokenWeight
    const remainingTokens = maxTokens - titleTokens

    if (remainingTokens <= 0) {
      return {
        truncatedContent: "",
        isTruncated: true,
        totalLength: content.length,
        truncatedLength: 0,
        summary: "内容过长，已被完全截断",
      }
    }

    const selectedParagraphs = []
    let usedTokens = 0

    // 1. 添加所有标题
    const headings = paragraphs.filter(p => p.isHeading)
    for (const heading of headings) {
      if (usedTokens + heading.tokenEstimate <= remainingTokens) {
        selectedParagraphs.push(heading)
        usedTokens += heading.tokenEstimate
      }
    }

    // 2. 添加开头段落（介绍部分）
    const introParagraphs = paragraphs.filter(p => !p.isHeading && p.position < 0.2)
    for (const para of introParagraphs.slice(0, 5)) {
      if (usedTokens + para.tokenEstimate <= remainingTokens) {
        selectedParagraphs.push(para)
        usedTokens += para.tokenEstimate
      }
    }

    // 3. 添加结尾段落（结论部分）
    const conclusionParagraphs = paragraphs.filter(p => !p.isHeading && p.position > 0.8)
    for (const para of conclusionParagraphs.slice(-3)) {
      if (usedTokens + para.tokenEstimate <= remainingTokens) {
        selectedParagraphs.push(para)
        usedTokens += para.tokenEstimate
      }
    }

    // 4. 从中间部分选择性添加较长的段落
    const middleParagraphs = paragraphs.filter(p => !p.isHeading && p.position >= 0.2 && p.position <= 0.8)
    const sortedMiddle = [...middleParagraphs].sort((a, b) => b.length - a.length)

    for (const para of sortedMiddle) {
      if (usedTokens + para.tokenEstimate <= remainingTokens) {
        selectedParagraphs.push(para)
        usedTokens += para.tokenEstimate
      }
    }

    // 按原始顺序排序
    selectedParagraphs.sort((a, b) => paragraphs.indexOf(a) - paragraphs.indexOf(b))

    const truncatedContent = selectedParagraphs.map(p => p.text).join("\n\n")
    const summary = `[内容已截断] 原文共 ${content.length} 字符 (约 ${totalTokens} tokens)，已保留 ${truncatedContent.length} 字符 (约 ${usedTokens} tokens)。保留了 ${selectedParagraphs.length} 个段落，包括标题、介绍部分、结论部分和重要的中间段落。`

    return {
      truncatedContent,
      isTruncated: true,
      totalLength: content.length,
      truncatedLength: truncatedContent.length,
      summary,
    }
  }

  // 消息类型定义（与 Content Script 中的定义一致）
  interface ExtractContentRequest {
    action: "extractContent"
  }

  interface ExtractContentResponse {
    success: boolean
    title?: string
    content?: string
    url?: string
    contentType?: "html" | "pdf" | "text"
    isTruncated?: boolean
    summary?: string
    error?: string
  }

  // 带超时的消息发送
  const sendMessageWithTimeout = (
    tabId: number,
    message: ExtractContentRequest,
    timeout: number = 5000
  ): Promise<ExtractContentResponse> => {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Message timeout"))
      }, timeout)

      chrome.tabs.sendMessage(tabId, message, (response) => {
        clearTimeout(timeoutId)
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          resolve(response)
        }
      })
    })
  }

  // 使用 pdf.js 解析 PDF（在扩展上下文中执行）
  const parsePdfWithPdfJs = async (tabId: number): Promise<ExtractedContent> => {
    try {
      // 首先获取 PDF 的 URL 和基本信息
      const urlResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          return {
            url: window.location.href,
            title: document.title || "PDF Document",
            isPdf: document.contentType === "application/pdf" || window.location.href.endsWith(".pdf")
          }
        }
      })

      if (!urlResults?.[0]?.result?.isPdf) {
        return {
          success: false,
          title: "",
          content: "",
          url: "",
          contentType: "html",
          isTruncated: false,
          error: "当前页面不是 PDF"
        }
      }

      const { url, title } = urlResults[0].result

      // 尝试在页面上下文中获取 PDF 数据（携带 cookie）
      const pdfDataResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: async () => {
          try {
            const response = await fetch(window.location.href, {
              credentials: 'include',
              mode: 'cors'
            })

            if (response.ok) {
              const arrayBuffer = await response.arrayBuffer()
              const uint8Array = new Uint8Array(arrayBuffer)
              let binary = ''
              for (let i = 0; i < uint8Array.byteLength; i++) {
                binary += String.fromCharCode(uint8Array[i])
              }
              return {
                success: true,
                data: btoa(binary)
              }
            }
          } catch (e) {
            console.error("Fetch PDF failed:", e)
          }
          return { success: false }
        }
      })

      if (pdfDataResults?.[0]?.result?.success) {
        try {
          // 动态导入 pdf.js
          const pdfjsLib = await import('pdfjs-dist')

          // 设置 worker - 使用从 node_modules 导入的 worker
          // Plasmo 会自动将 node_modules/pdfjs-dist/build/pdf.worker.min.mjs 复制到构建目录的根目录
          // 文件名是 pdf.worker.min.mjs，通过 web_accessible_resources 配置
          const workerUrl = chrome.runtime.getURL('pdf.worker.min.mjs')
          pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

          // 解码 base64 数据
          const base64Data = pdfDataResults[0].result.data ?? ""
          const binaryString = atob(base64Data)
          const uint8Array = new Uint8Array(binaryString.length)
          for (let i = 0; i < binaryString.length; i++) {
            uint8Array[i] = binaryString.charCodeAt(i)
          }

          // 加载 PDF 文档
          const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise

          // 提取所有页面的文本
          const fullText: string[] = []
          const numPages = pdf.numPages

          for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            const page = await pdf.getPage(pageNum)
            const textContent = await page.getTextContent()

            const pageText: string[] = []
            let lastY = 0
            let lastFontSize = 0

            textContent.items.forEach((item: any) => {
              // 检测换行（基于 Y 坐标变化或字体大小变化）
              if (Math.abs(item.transform[5] - lastY) > 5 ||
                  (item.height && Math.abs(item.height - lastFontSize) > 2)) {
                pageText.push('\n')
              }
              pageText.push(item.str)
              lastY = item.transform[5]
              if (item.height) lastFontSize = item.height
            })

            fullText.push(`--- 第 ${pageNum} 页 ---\n${pageText.join(' ')}`)
          }

          const content = fullText.join('\n\n')
          const truncationResult = smartTruncate(title, content)

          return {
            success: true,
            title,
            content: truncationResult.truncatedContent,
            url,
            contentType: "pdf",
            isTruncated: truncationResult.isTruncated,
            summary: truncationResult.summary
          }
        } catch (pdfError) {
          console.error("PDF 解析失败:", pdfError)
          return {
            success: false,
            title,
            content: "",
            url,
            contentType: "pdf",
            isTruncated: false,
            error: `PDF 解析失败: ${pdfError instanceof Error ? pdfError.message : "未知错误"}`
          }
        }
      } else {
        // 尝试从页面 DOM 中提取 PDF 文本（适用于某些 PDF 查看器）
        const domResults = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            // 尝试从不同类型的 PDF 查看器中提取文本
            let content = ""

            // 1. 尝试查找文本层（许多现代 PDF 查看器使用）
            const textLayers = document.querySelectorAll('[class*="textLayer"], [id*="textLayer"]')
            if (textLayers.length > 0) {
              const texts: string[] = []
              textLayers.forEach(layer => {
                const text = layer.textContent?.trim() || ""
                if (text.length > 0) {
                  texts.push(text)
                }
              })
              content = texts.join("\n\n")
            }

            // 2. 尝试查找 canvas 旁边的隐藏文本（某些查看器的做法）
            if (!content) {
              const hiddenTexts = document.querySelectorAll('span[style*="hidden"], div[style*="hidden"]')
              const texts: string[] = []
              hiddenTexts.forEach(el => {
                const text = el.textContent?.trim() || ""
                if (text.length > 20) {
                  texts.push(text)
                }
              })
              if (texts.length > 0) {
                content = texts.join("\n\n")
              }
            }

            // 3. 尝试从 body 中提取所有文本（备用方案）
            if (!content) {
              content = document.body.textContent || ""
            }

            return content
          }
        })

        const domContent = domResults?.[0]?.result || ""
        if (domContent && domContent.length > 100) {
          const truncationResult = smartTruncate(title, domContent)
          return {
            success: true,
            title,
            content: truncationResult.truncatedContent,
            url,
            contentType: "pdf",
            isTruncated: truncationResult.isTruncated,
            summary: truncationResult.summary
          }
        }

        return {
          success: false,
          title,
          content: "",
          url,
          contentType: "pdf",
          isTruncated: false,
          error: "无法从 PDF 中提取文本。请确保：1) PDF 已完全加载 2) 扩展有访问文件的权限（对于本地 PDF，需要在扩展设置中启用 '允许访问文件网址'）"
        }
      }
    } catch (e) {
      console.error("Failed to parse PDF with pdf.js:", e)
      return {
        success: false,
        title: "",
        content: "",
        url: "",
        contentType: "pdf",
        isTruncated: false,
        error: `PDF 处理失败: ${e instanceof Error ? e.message : "未知错误"}`
      }
    }
  }

  // 使用简化的内联逻辑提取 HTML 内容（当 Content Script 不可用时使用）
  const extractHtmlWithInlineScript = async (tabId: number): Promise<ExtractedContent> => {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // 内联的简化版内容提取逻辑
          // 由于无法在 executeScript 中使用外部库，我们实现一个简化但有效的版本

          const title = document.title || ""
          const url = window.location.href

          // 噪音元素选择器
          const noiseSelectors = [
            "script", "style", "noscript", "iframe",
            "nav", "header", "footer", "aside",
            ".ad", ".ads", ".advertisement", ".advertising",
            ".banner", ".sidebar", ".widget",
            ".comments", ".comment-section",
            ".social", ".share", ".like",
            ".related", ".recommended", ".trending",
            ".cookie", ".gdpr", ".consent",
            ".popup", ".modal", ".overlay",
          ]

          // 清理文档（克隆后清理，不影响原始页面）
          const clone = document.cloneNode(true) as Document

          noiseSelectors.forEach(selector => {
            try {
              const elements = clone.querySelectorAll(selector)
              elements.forEach(el => el.remove())
            } catch (e) {}
          })

          // 尝试查找主要内容区域
          const mainSelectors = [
            "main", "article", "[role='main']",
            ".post", ".article", ".content", "#content",
            ".post-content", ".article-content", ".entry-content",
          ]

          let mainContent = ""

          for (const selector of mainSelectors) {
            try {
              const element = clone.querySelector(selector)
              const textContent = element?.textContent ?? ""
              if (element && textContent.trim().length > 500) {
                mainContent = textContent
                break
              }
            } catch (e) {}
          }

          // 如果没有找到主要内容区域，收集所有有意义的段落
          if (!mainContent || mainContent.trim().length < 100) {
            const paragraphs = clone.querySelectorAll("p")
            const texts: string[] = []

            paragraphs.forEach((p) => {
              const text = p.textContent?.trim() || ""
              if (text.length > 30) {
                texts.push(text)
              }
            })

            mainContent = texts.join("\n\n")
          }

          // 最终备用方案
          if (!mainContent || mainContent.trim().length < 100) {
            mainContent = clone.body.textContent || ""
          }

          return {
            title,
            content: mainContent,
            url
          }
        }
      })

      if (results?.[0]?.result) {
        const { title, content, url } = results[0].result

        // 检查内容是否有效
        if (!content || content.trim().length < 100) {
          return {
            success: false,
            title,
            content: "",
            url,
            contentType: "html",
            isTruncated: false,
            error: "无法从页面中提取有效内容。页面可能是空的或内容被动态加载。"
          }
        }

        const truncationResult = smartTruncate(title, content)

        return {
          success: true,
          title,
          content: truncationResult.truncatedContent,
          url,
          contentType: "html",
          isTruncated: truncationResult.isTruncated,
          summary: truncationResult.summary
        }
      }

      return {
        success: false,
        title: "",
        content: "",
        url: "",
        contentType: "html",
        isTruncated: false,
        error: "无法执行内容提取脚本"
      }
    } catch (e) {
      console.error("Failed to extract HTML with inline script:", e)
      return {
        success: false,
        title: "",
        content: "",
        url: "",
        contentType: "html",
        isTruncated: false,
        error: `内容提取失败: ${e instanceof Error ? e.message : "未知错误"}`
      }
    }
  }

  // 检测页面类型
  const detectPageType = async (tabId: number): Promise<"html" | "pdf" | "text"> => {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // 检查是否是 PDF 查看器页面
        if (document.contentType === "application/pdf" ||
            window.location.href.endsWith(".pdf") ||
            document.querySelector("embed[type='application/pdf']") ||
            document.querySelector("object[type='application/pdf']")) {
          return "pdf"
        }

        // 检查是否是纯文本页面
        if (document.contentType === "text/plain") {
          return "text"
        }

        return "html"
      }
    })

    return results?.[0]?.result || "html"
  }

  const getPageContent = async (): Promise<ExtractedContent> => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab.id) {
        return {
          success: false,
          title: "",
          content: "",
          url: "",
          contentType: "html",
          isTruncated: false,
          error: "无法获取当前标签页"
        }
      }

      // 检测页面类型
      const pageType = await detectPageType(tab.id)

      // 如果是 PDF，使用 pdf.js 解析
      if (pageType === "pdf") {
        return await parsePdfWithPdfJs(tab.id)
      }

      // 首选方案：使用消息通信与 Content Script 交互
      // Content Script 真正导入和使用 @mozilla/readability
      try {
        const response = await sendMessageWithTimeout(tab.id, { action: "extractContent" })

        if (response.success) {
          // 检查内容是否有效
          if (!response.content || response.content.trim().length < 100) {
            // 内容太少，尝试使用内联脚本再次提取
            console.warn("Content script returned too little content, trying inline script")
          } else {
            return {
              success: true,
              title: response.title || "",
              content: response.content || "",
              url: response.url || "",
              contentType: response.contentType || "html",
              isTruncated: response.isTruncated || false,
              summary: response.summary
            }
          }
        } else {
          console.error("Content script extraction failed:", response.error)
        }
      } catch (messageError) {
        // 消息通信失败是正常的（页面可能在扩展安装前打开）
        // 不需要记录错误，直接使用备用方案
        console.log("Content script not available, using inline extraction")
      }

      // 备用方案：使用内联脚本提取
      console.log("Using inline content extraction as fallback")
      const inlineResult = await extractHtmlWithInlineScript(tab.id)

      if (inlineResult.success) {
        return inlineResult
      }

      // 所有方案都失败，返回明确的错误
      console.error("All content extraction methods failed")
      return {
        success: false,
        title: "",
        content: "",
        url: "",
        contentType: pageType,
        isTruncated: false,
        error: inlineResult.error || "无法从页面中提取内容。请尝试刷新页面后重试。"
      }
    } catch (error) {
      console.error("Failed to get page content:", error)
      return {
        success: false,
        title: "",
        content: "",
        url: "",
        contentType: "html",
        isTruncated: false,
        error: `内容提取失败: ${error instanceof Error ? error.message : "未知错误"}`
      }
    }
  }

  const callOpenAI = async (msgs: Message[]): Promise<string> => {
    if (!config.apiKey || !config.baseURL) {
      throw new Error("请先配置 API 参数")
    }

    const baseURL = config.baseURL.endsWith("/") ? config.baseURL : config.baseURL + "/"
    const url = baseURL + "chat/completions"

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model || "gpt-4o",
        messages: msgs.map(m => ({
          role: m.role,
          content: m.content
        })),
        temperature: 0.7,
        max_tokens: 1500
      })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error?.message || `API 错误: ${response.status}`)
    }

    const data = await response.json()
    let content = data.choices[0]?.message?.content || ""

    content = stripThinkTags(content)

    return content
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
      
      // 检测是否是本地文件
      const isLocal = tab?.url?.startsWith("file://") || false
      setIsLocalFile(isLocal)
      
      if (!tab?.url || (!tab.url.startsWith("http") && !isLocal)) {
        setPageKey("")
        setRounds([])
        setActiveRoundId(null)
        setViewingRoundId(null)
        return
      }

      const key = generatePageKey(tab.url)

      if (key === pageKeyRef.current) {
        setShowHistoryPanel(false)
        setViewingRoundId(null)
        return
      }

      setPageKey(key)
      setPageUrl(tab.url)
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

    // 对于本地文件，先检查是否有权限访问
    if (isLocalFile) {
      setExtractionProgress("正在检查文件访问权限...")
    }

    setIsLoading(true)
    setIsExtractingContent(true)
    setErrorMessage(null)

    try {
      setExtractionProgress("正在提取页面内容...")
      const pageInfo = await getPageContent()

      // 检查内容提取是否成功
      if (!pageInfo.success) {
        let errorMessage = pageInfo.error || "无法从页面中提取内容"
        
        // 对于本地文件，提供更详细的错误信息和引导
        if (isLocalFile) {
          setShowFilePermissionGuide(true)
          errorMessage = "无法访问本地文件。请确保已开启扩展的文件访问权限。"
        }
        
        setErrorMessage(errorMessage)
        setIsLoading(false)
        setIsExtractingContent(false)
        setExtractionProgress("")
        return
      }

      // 检查内容是否有效
      if (!pageInfo.content || pageInfo.content.trim().length < 50) {
        setErrorMessage("页面内容太少，无法进行有效的阅读对话。请确保页面有足够的文本内容。")
        setIsLoading(false)
        setIsExtractingContent(false)
        setExtractionProgress("")
        return
      }

      setExtractionProgress("正在处理内容...")

      // 根据内容类型设置初始提示
      let contextPrompt = ""
      if (pageInfo.contentType === "pdf") {
        contextPrompt = "用户正在浏览一个 PDF 文档。"
      } else if (pageInfo.contentType === "text") {
        contextPrompt = "用户正在浏览一个纯文本页面。"
      } else {
        contextPrompt = "用户正在浏览一个网页。"
      }

      if (pageInfo.title) {
        contextPrompt += `\n\n文档标题：${pageInfo.title}`
      }
      if (pageInfo.url) {
        try {
          const urlObj = new URL(pageInfo.url)
          contextPrompt += `\n来源网站：${urlObj.hostname}`
        } catch {}
      }
      
      // 添加截断信息（如果有）
      if (pageInfo.isTruncated && pageInfo.summary) {
        contextPrompt += `\n\n${pageInfo.summary}`
      }
      
      // 添加内容（已通过智能截断处理）
      contextPrompt += `\n\n文档内容：\n${pageInfo.content}`

      const roundId = generateId()

      const initialMessage: Message = {
        id: generateId(),
        role: "system",
        content: SOCRATES_SYSTEM_PROMPT + "\n\n" + contextPrompt,
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

      const aiResponse = await callOpenAI([initialMessage, firstUserMessage])

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
      setIsExtractingContent(false)
      setExtractionProgress("")
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

    const shouldComplete = isSummaryRequest(input.trim())
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
      const response = await callOpenAI(messagesAfterUser)
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

    const internalInstruction: Message = {
      id: generateId(),
      role: "user",
      content: "用户现在希望总结我们的对话和文档的核心内容。请提供一个简洁、清晰的总结，包括：1) 文档的核心主题，2) 我们讨论过的关键点，3) 主要的理解收获。",
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
    setIsLoading(true)
    setErrorMessage(null)
    if (pageKey) await savePageConversations(pageKey, roundsAfterUser)

    try {
      const messagesForAI = [...currentRound.messages, internalInstruction]
      const response = await callOpenAI(messagesForAI)
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
                
                {showFilePermissionGuide ? (
                  <div className="w-full max-w-sm">
                    <div className="bg-notion-bg-secondary border border-notion-border rounded-2xl p-6 text-left">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-base font-bold text-notion-text">需要文件访问权限</h3>
                        <button
                          onClick={() => setShowFilePermissionGuide(false)}
                          className="p-1 hover:bg-notion-hover rounded-lg transition-colors"
                        >
                          <svg className="w-4 h-4 text-notion-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      
                      <p className="text-sm text-notion-text-secondary mb-6 leading-relaxed">
                        为了让苏格拉底导师能够读取您的本地 PDF 和 HTML 文件，您需要为扩展开启文件访问权限。
                      </p>
                      
                      <div className="space-y-4 mb-6">
                        <div className="flex items-start gap-3">
                          <div className="w-6 h-6 rounded-full bg-notion-accent/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <span className="text-xs font-bold text-notion-accent">1</span>
                          </div>
                          <div>
                            <p className="text-sm text-notion-text-secondary">
                              点击浏览器工具栏中的扩展图标（拼图图标）
                            </p>
                            <p className="text-xs text-notion-text-secondary/70 mt-1">
                              或在地址栏输入 chrome://extensions/ 并回车
                            </p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="w-6 h-6 rounded-full bg-notion-accent/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <span className="text-xs font-bold text-notion-accent">2</span>
                          </div>
                          <p className="text-sm text-notion-text-secondary">
                            找到「苏格拉底式阅读助手」扩展，点击「详情」
                          </p>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="w-6 h-6 rounded-full bg-notion-accent/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <span className="text-xs font-bold text-notion-accent">3</span>
                          </div>
                          <div>
                            <p className="text-sm text-notion-text-secondary">
                              找到「允许此扩展读取和更改您在所有网站上的所有数据」
                            </p>
                            <p className="text-xs text-notion-text-secondary/70 mt-1">
                              选择「在所有网站上」
                            </p>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex gap-3">
                        <button
                          onClick={async () => {
                            try {
                              await chrome.tabs.create({ url: 'chrome://extensions/' })
                            } catch {
                              try {
                                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
                                if (tab?.id) {
                                  await chrome.tabs.update(tab.id, { url: 'chrome://extensions/' })
                                }
                              } catch {
                                console.error('无法打开扩展管理页面，请手动输入 chrome://extensions/')
                              }
                            }
                          }}
                          className="flex-1 px-4 py-2.5 bg-notion-accent text-white rounded-xl font-medium hover:bg-notion-accent-hover transition-all active:scale-95"
                        >
                          打开扩展管理页面
                        </button>
                      </div>
                      
                      <p className="text-xs text-notion-text-secondary/60 mt-3 text-center">
                        如按钮无效，请手动在地址栏输入 chrome://extensions/
                      </p>
                    </div>
                    
                    <button
                      onClick={() => setShowFilePermissionGuide(false)}
                      className="w-full mt-4 px-4 py-2 text-sm text-notion-text-secondary hover:text-notion-text transition-colors"
                    >
                      稍后再说
                    </button>
                  </div>
                ) : isExtractingContent ? (
                  <div className="flex flex-col items-center">
                    <div className="w-20 h-20 bg-notion-bg-secondary rounded-2xl flex items-center justify-center mb-6 border border-notion-border/50">
                      <div className="relative">
                        <div className="w-10 h-10 border-4 border-notion-accent/20 rounded-full" />
                        <div className="absolute top-0 left-0 w-10 h-10 border-4 border-notion-accent border-t-transparent rounded-full animate-spin" />
                      </div>
                    </div>
                    <h3 className="text-lg font-bold text-notion-text mb-2">
                      {extractionProgress || "正在提取页面内容..."}
                    </h3>
                    <p className="text-sm text-notion-text-secondary opacity-80">
                      请稍候，导师正在阅读此文档
                    </p>
                  </div>
                ) : (
                  <>
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
                  </>
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
                {isLoading && (
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
                    <div className="flex flex-col gap-3 px-4 py-3 bg-notion-bg-secondary border border-notion-border rounded-xl max-w-sm w-full">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                          <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <p className="text-sm text-notion-text leading-relaxed">
                            {errorMessage}
                          </p>
                        </div>
                        <button
                          onClick={() => setErrorMessage(null)}
                          className="p-1 hover:bg-notion-hover rounded-lg transition-colors flex-shrink-0"
                        >
                          <svg className="w-4 h-4 text-notion-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      
                      {showFilePermissionGuide && (
                        <button
                          onClick={() => {
                            chrome.runtime.openOptionsPage()
                          }}
                          className="w-full px-3 py-2 bg-notion-accent text-white rounded-lg text-sm font-medium hover:bg-notion-accent-hover transition-all"
                        >
                          前往设置权限
                        </button>
                      )}
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
