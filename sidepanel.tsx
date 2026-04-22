import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import { OpenAIConfig, DEFAULT_OPENAI_CONFIG } from "./lib/types"
import "./style.css"

interface Message {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
  visible: boolean
}

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

function SidePanel() {
  const [config] = useStorage<OpenAIConfig>("openai-config", DEFAULT_OPENAI_CONFIG)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [hasConfig, setHasConfig] = useState(false)
  const [conversationStarted, setConversationStarted] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (config) {
      setHasConfig(!!config.apiKey && !!config.baseURL)
    }
  }, [config])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const getPageContent = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab.id) {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            let title = document.title || ""
            let content = ""

            const mainContent = document.querySelector('main, article, [role="main"], .post, .article, #content')
            if (mainContent) {
              content = (mainContent as HTMLElement).innerText
            } else {
              const paragraphs = document.querySelectorAll('p')
              if (paragraphs.length > 3) {
                const texts: string[] = []
                paragraphs.forEach((p, i) => {
                  if (i < 20) texts.push((p as HTMLElement).innerText)
                })
                content = texts.join("\n\n")
              } else {
                content = document.body.innerText
              }
            }

            return {
              title: title.slice(0, 200),
              content: content.slice(0, 6000),
              url: window.location.href
            }
          }
        })
        if (results && results[0]?.result) {
          const result = results[0].result as { title: string; content: string; url: string }
          return result
        }
      }
    } catch (error) {
      console.error("Failed to get page content:", error)
    }
    return { title: "", content: "", url: "" }
  }

  const generateId = () => Date.now().toString() + Math.random().toString(36).slice(2, 11)

  const callOpenAI = async (messages: Message[]): Promise<string> => {
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
        messages: messages.map(m => ({
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

  const startConversation = useCallback(async () => {
    if (!hasConfig) {
      chrome.runtime.openOptionsPage()
      return
    }

    setIsLoading(true)
    setErrorMessage(null)

    try {
      const pageInfo = await getPageContent()

      let contextPrompt = "用户正在浏览一个网页。"

      if (pageInfo.title) {
        contextPrompt += `\n\n网页标题：${pageInfo.title}`
      }
      if (pageInfo.url) {
        try {
          const urlObj = new URL(pageInfo.url)
          contextPrompt += `\n网站：${urlObj.hostname}`
        } catch {}
      }
      if (pageInfo.content && pageInfo.content.length > 50) {
        contextPrompt += `\n\n网页内容（开头部分）：\n${pageInfo.content.slice(0, 4000)}`
      }

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

      const aiResponse = await callOpenAI([initialMessage, firstUserMessage])

      const assistantMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: aiResponse,
        timestamp: Date.now(),
        visible: true
      }

      setMessages([initialMessage, firstUserMessage, assistantMessage])
      setConversationStarted(true)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "未知错误")
    } finally {
      setIsLoading(false)
    }
  }, [hasConfig, config])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
      visible: true
    }

    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput("")
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const response = await callOpenAI(newMessages)
      const assistantMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: response,
        timestamp: Date.now(),
        visible: true
      }
      setMessages([...newMessages, assistantMessage])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "未知错误")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSummarize = async () => {
    if (isLoading || messages.length === 0) return

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

    const messagesWithUserAction = [...messages, userActionMessage]
    const messagesForAI = [...messages, internalInstruction]
    setMessages(messagesWithUserAction)
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const response = await callOpenAI(messagesForAI)
      const assistantMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: response,
        timestamp: Date.now(),
        visible: true
      }
      setMessages([...messagesWithUserAction, assistantMessage])
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

  const clearConversation = () => {
    setMessages([])
    setConversationStarted(false)
    setErrorMessage(null)
  }

  const displayMessages = messages.filter(m => m.visible)

  return (
    <div className="flex flex-col h-full bg-notion-bg text-notion-text transition-colors duration-300">
      {/* 头部：导师感与极简功能 */}
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
              <span className="text-[10px] font-medium text-notion-text-secondary truncate">在线思辨中</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {conversationStarted && (
            <>
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
              <button
                onClick={clearConversation}
                className="p-1.5 text-notion-text-secondary hover:bg-red-500/10 hover:text-red-500 rounded-lg transition-colors"
                title="开启新对话"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </>
          )}
        </div>
      </header>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!conversationStarted ? (
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

            {!hasConfig && (
              <p className="mt-8 text-xs text-notion-text-secondary flex items-center gap-1.5 opacity-60">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                需在设置中配置 API 密钥
              </p>
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
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 输入区：Notion 风格命令感 */}
      {conversationStarted && (
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
    </div>
  )
}

export default SidePanel
