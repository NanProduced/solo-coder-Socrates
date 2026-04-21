import { useState, useEffect, useRef } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import "./style.css"

interface Message {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
}

interface OpenAIConfig {
  baseURL: string
  apiKey: string
  model: string
}

const SOCRATES_SYSTEM_PROMPT = `你是苏格拉底，一位伟大的哲学家和导师。你的教学方法是通过提问来引导学生自己发现真理，而不是直接给出答案。

核心原则：
1. **一次只问一个问题** - 不要连续提出多个问题
2. **动态调整深度**：
   - 如果用户回答正确/深入，追问更深入的问题
   - 如果用户回答偏离主题，换个角度重新提问
   - 如果用户表示不懂，给出线索或提示性问题
3. **不要直接总结** - 只有当用户明确说"帮我总结"或点击"总结"按钮时才提供总结
4. **保持苏格拉底式风格** - 温和、好奇、引导性，用问题激发思考

对话流程：
1. 开始时，先了解用户正在阅读的文档，问一个关于文档核心主题的问题
2. 根据用户的回答，判断理解程度，调整下一个问题
3. 持续深入，直到用户真正理解核心概念

你的回答应该：
- 像苏格拉底那样对话，使用温和的语气
- 提出的问题要能激发批判性思考
- 当用户说"总结"或"帮我总结"时，才提供简洁的总结
- 不要说教，要引导`

function SidePanel() {
  const [config] = useStorage<OpenAIConfig>("openai-config", {
    baseURL: "",
    apiKey: "",
    model: ""
  })

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [pageContent, setPageContent] = useState("")
  const [hasConfig, setHasConfig] = useState(false)
  const [conversationStarted, setConversationStarted] = useState(false)

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
            return document.body.innerText.slice(0, 8000)
          }
        })
        if (results && results[0]?.result) {
          return results[0].result as string
        }
      }
    } catch (error) {
      console.error("Failed to get page content:", error)
    }
    return ""
  }

  const generateId = () => Date.now().toString() + Math.random().toString(36).substr(2, 9)

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
        max_tokens: 1000
      })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error?.message || `API 错误: ${response.status}`)
    }

    const data = await response.json()
    return data.choices[0]?.message?.content || ""
  }

  const startConversation = async () => {
    if (!hasConfig) {
      chrome.runtime.openOptionsPage()
      return
    }

    setIsLoading(true)
    const content = await getPageContent()
    setPageContent(content)

    const initialMessage: Message = {
      id: generateId(),
      role: "system",
      content: SOCRATES_SYSTEM_PROMPT + (content ? `\n\n用户正在阅读的文档内容（开头部分）：\n${content}` : ""),
      timestamp: Date.now()
    }

    const welcomeMessage: Message = {
      id: generateId(),
      role: "assistant",
      content: "你好！我是苏格拉底。我注意到你正在阅读一篇文档。让我们一起探索其中的智慧吧。\n\n这篇文档的核心主题是什么？你对它有什么初步的理解？",
      timestamp: Date.now()
    }

    setMessages([initialMessage, welcomeMessage])
    setConversationStarted(true)
    setIsLoading(false)
  }

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now()
    }

    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput("")
    setIsLoading(true)

    try {
      const response = await callOpenAI(newMessages)
      const assistantMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: response,
        timestamp: Date.now()
      }
      setMessages([...newMessages, assistantMessage])
    } catch (error) {
      const errorMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: `抱歉，出现了错误：${error instanceof Error ? error.message : "未知错误"}。请检查你的 API 配置。`,
        timestamp: Date.now()
      }
      setMessages([...newMessages, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleSummarize = async () => {
    if (isLoading || messages.length === 0) return

    const summarizePrompt: Message = {
      id: generateId(),
      role: "user",
      content: "帮我总结",
      timestamp: Date.now()
    }

    const newMessages = [...messages, summarizePrompt]
    setMessages(newMessages)
    setIsLoading(true)

    try {
      const response = await callOpenAI([
        ...newMessages.slice(0, -1),
        {
          id: generateId(),
          role: "user",
          content: "用户现在希望总结我们的对话和文档的核心内容。请提供一个简洁、清晰的总结，包括：1) 文档的核心主题，2) 我们讨论过的关键点，3) 主要的理解收获。",
          timestamp: Date.now()
        }
      ])
      const assistantMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: response,
        timestamp: Date.now()
      }
      setMessages([...newMessages, assistantMessage])
    } catch (error) {
      const errorMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: `抱歉，出现了错误：${error instanceof Error ? error.message : "未知错误"}。`,
        timestamp: Date.now()
      }
      setMessages([...newMessages, errorMessage])
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
  }

  const displayMessages = messages.filter(m => m.role !== "system")

  return (
    <div className="flex flex-col h-full bg-notion-bg">
      <div className="flex items-center justify-between px-4 py-3 border-b border-notion-border bg-notion-bg">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-notion-accent rounded-md flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-notion-text">苏格拉底</h1>
            <p className="text-xs text-notion-text-secondary">阅读助手</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {conversationStarted && (
            <button
              onClick={handleSummarize}
              disabled={isLoading}
              className="p-1.5 text-notion-text-secondary hover:text-notion-text hover:bg-notion-hover rounded transition-colors disabled:opacity-50"
              title="总结对话"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            </button>
          )}
          {conversationStarted && (
            <button
              onClick={clearConversation}
              className="p-1.5 text-notion-text-secondary hover:text-notion-text hover:bg-notion-hover rounded transition-colors"
              title="清空对话"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
        {!conversationStarted ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 bg-notion-bg-secondary rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-notion-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <h2 className="text-lg font-medium text-notion-text mb-2">
              开始苏格拉底式阅读
            </h2>
            <p className="text-sm text-notion-text-secondary mb-6 max-w-xs">
              通过连续提问，引导你主动思考，真正理解文档的核心内容
            </p>
            <button
              onClick={startConversation}
              disabled={isLoading}
              className="px-6 py-2.5 bg-notion-accent text-white rounded-md font-medium hover:bg-notion-accent-hover transition-colors disabled:opacity-50"
            >
              {isLoading ? "加载中..." : "开始对话"}
            </button>
            {!hasConfig && (
              <p className="mt-3 text-xs text-notion-text-secondary">
                请先在设置中配置 API 参数
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {displayMessages.map((message, index) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] ${
                    message.role === "user"
                      ? "bg-notion-accent text-white rounded-t-lg rounded-bl-lg px-4 py-2.5"
                      : "bg-notion-bg-secondary text-notion-text rounded-t-lg rounded-br-lg px-4 py-2.5"
                  }`}
                >
                  <div className="text-sm whitespace-pre-wrap leading-relaxed">
                    {message.content}
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-notion-bg-secondary text-notion-text rounded-t-lg rounded-br-lg px-4 py-2.5">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-notion-text-secondary rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-2 h-2 bg-notion-text-secondary rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-2 h-2 bg-notion-text-secondary rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {conversationStarted && (
        <div className="border-t border-notion-border bg-notion-bg p-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入你的回答..."
              rows={1}
              disabled={isLoading}
              className="flex-1 resize-none px-3 py-2 bg-notion-bg-secondary border border-transparent rounded-md text-sm text-notion-text placeholder-notion-text-secondary focus:outline-none focus:border-notion-border focus:bg-notion-bg transition-all disabled:opacity-50"
              style={{ minHeight: "36px", maxHeight: "120px" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement
                target.style.height = "auto"
                target.style.height = Math.min(target.scrollHeight, 120) + "px"
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="p-2 bg-notion-accent text-white rounded-md hover:bg-notion-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
          <p className="mt-2 text-xs text-notion-text-secondary text-center">
            按 Enter 发送，Shift+Enter 换行
          </p>
        </div>
      )}
    </div>
  )
}

export default SidePanel
