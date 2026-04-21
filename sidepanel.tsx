import { useState, useEffect, useRef, useCallback } from "react"
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
              content = mainContent.innerText
            } else {
              const paragraphs = document.querySelectorAll('p')
              if (paragraphs.length > 3) {
                const texts: string[] = []
                paragraphs.forEach((p, i) => {
                  if (i < 20) texts.push(p.innerText)
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

  const generateId = () => Date.now().toString() + Math.random().toString(36).substr(2, 9)

  const stripThinkTags = (content: string): string => {
    let result = content
    const thinkPattern = /<think>[\s\S]*?<\/think>/g
    result = result.replace(thinkPattern, "")
    
    let lastResult
    do {
      lastResult = result
      result = result
        .replace(/^<think[\s\S]*$/, "")
        .replace(/^[\s\S]*?<\/think>/, "")
    } while (result !== lastResult)
    
    return result.trim()
  }

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
    setConversationStarted(true)

    try {
      const pageInfo = await getPageContent()
      setPageContent(pageInfo.content)

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
        timestamp: Date.now()
      }

      const firstUserMessage: Message = {
        id: generateId(),
        role: "user",
        content: "我想开始阅读这篇文档，请引导我理解它。",
        timestamp: Date.now()
      }

      const aiResponse = await callOpenAI([initialMessage, firstUserMessage])

      const assistantMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: aiResponse,
        timestamp: Date.now()
      }

      setMessages([initialMessage, assistantMessage])
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
      timestamp: Date.now()
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
        timestamp: Date.now()
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

    const summarizePrompt: Message = {
      id: generateId(),
      role: "user",
      content: "用户现在希望总结我们的对话和文档的核心内容。请提供一个简洁、清晰的总结，包括：1) 文档的核心主题，2) 我们讨论过的关键点，3) 主要的理解收获。",
      timestamp: Date.now()
    }

    const newMessages = [...messages, summarizePrompt]
    setMessages(newMessages)
    setIsLoading(true)
    setErrorMessage(null)

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

  const displayMessages = messages.filter(m => m.role !== "system")

  const formatMessage = (content: string) => {
    return content
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '</p><p class="mt-2">')
      .replace(/\n/g, '<br/>')
  }

  return (
    <div className="flex flex-col h-full bg-[#fcfcfc]">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#eaeaea] bg-white">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-[#2eaadc] to-[#1c96c5] rounded-lg flex items-center justify-center shadow-sm">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-[#37352f]">苏格拉底</h1>
            <p className="text-xs text-[#787774]">阅读助手</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {conversationStarted && (
            <button
              onClick={handleSummarize}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f7f6f3] text-[#37352f] rounded-lg hover:bg-[#2eaadc] hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              title="总结对话"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              <span className="hidden sm:inline">总结</span>
            </button>
          )}
          {conversationStarted && (
            <button
              onClick={clearConversation}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f7f6f3] text-[#37352f] rounded-lg hover:bg-[#ef4444] hover:text-white transition-all text-sm font-medium"
              title="新对话"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">新对话</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {!conversationStarted ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-20 h-20 bg-gradient-to-br from-[#e8f4f8] to-[#d0e8f0] rounded-2xl flex items-center justify-center mb-6 shadow-inner">
              <svg className="w-10 h-10 text-[#2eaadc]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-[#37352f] mb-2">
              苏格拉底式阅读
            </h2>
            <p className="text-sm text-[#787774] mb-8 max-w-xs leading-relaxed">
              通过连续提问，引导你主动思考，真正理解文档的核心内容
            </p>
            
            <button
              onClick={startConversation}
              disabled={isLoading}
              className="px-8 py-3 bg-gradient-to-r from-[#2eaadc] to-[#1c96c5] text-white rounded-xl font-medium hover:from-[#1c96c5] hover:to-[#1580a8] transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed text-base"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  分析页面中...
                </span>
              ) : "开始对话"}
            </button>
            
            {!hasConfig && (
              <div className="mt-6 px-4 py-3 bg-[#fff8e6] border border-[#ffe0b2] rounded-lg">
                <p className="text-xs text-[#e65100] flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  请先在设置中配置 API 参数
                </p>
              </div>
            )}

            {errorMessage && (
              <div className="mt-6 px-4 py-3 bg-[#ffebee] border border-[#ffcdd2] rounded-lg max-w-xs">
                <p className="text-xs text-[#c62828]">
                  错误: {errorMessage}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="p-5 space-y-6">
            {displayMessages.length === 0 && isLoading ? (
              <div className="flex justify-center py-8">
                <div className="flex flex-col items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 bg-[#2eaadc] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-2 h-2 bg-[#2eaadc] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-2 h-2 bg-[#2eaadc] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  <p className="text-xs text-[#787774]">正在分析页面内容...</p>
                </div>
              </div>
            ) : (
              <>
                {displayMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div className="flex items-end gap-2 max-w-[90%]">
                      {message.role === "assistant" && (
                        <div className="w-7 h-7 bg-gradient-to-br from-[#2eaadc] to-[#1c96c5] rounded-full flex-shrink-0 flex items-center justify-center shadow-sm">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                          </svg>
                        </div>
                      )}
                      <div
                        className={`px-4 py-3 ${
                          message.role === "user"
                            ? "bg-gradient-to-r from-[#2eaadc] to-[#1c96c5] text-white rounded-t-2xl rounded-bl-2xl shadow-md"
                            : "bg-white text-[#37352f] rounded-t-2xl rounded-br-2xl shadow-sm border border-[#eaeaea]"
                        }`}
                      >
                        <div 
                          className="text-sm leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: formatMessage(message.content) }}
                        />
                      </div>
                      {message.role === "user" && (
                        <div className="w-7 h-7 bg-[#37352f] rounded-full flex-shrink-0 flex items-center justify-center shadow-sm">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="flex items-end gap-2">
                      <div className="w-7 h-7 bg-gradient-to-br from-[#2eaadc] to-[#1c96c5] rounded-full flex-shrink-0 flex items-center justify-center shadow-sm">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      </div>
                      <div className="bg-white text-[#37352f] rounded-t-2xl rounded-br-2xl px-4 py-3 shadow-sm border border-[#eaeaea]">
                        <div className="flex items-center gap-1.5 py-0.5">
                          <div className="w-2 h-2 bg-[#2eaadc] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <div className="w-2 h-2 bg-[#2eaadc] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <div className="w-2 h-2 bg-[#2eaadc] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {errorMessage && (
              <div className="flex justify-center">
                <div className="px-4 py-3 bg-[#ffebee] border border-[#ffcdd2] rounded-xl max-w-xs">
                  <p className="text-sm text-[#c62828] flex items-center gap-2">
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

      {conversationStarted && (
        <div className="border-t border-[#eaeaea] bg-white p-4">
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入你的回答..."
                rows={1}
                disabled={isLoading}
                className="w-full resize-none px-4 py-3 bg-[#f7f6f3] border-2 border-transparent rounded-2xl text-sm text-[#37352f] placeholder-[#a9a8a5] focus:outline-none focus:border-[#2eaadc] focus:bg-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ minHeight: "44px", maxHeight: "140px" }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = "auto"
                  target.style.height = Math.min(target.scrollHeight, 140) + "px"
                }}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className={`p-3 rounded-2xl transition-all shadow-sm flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center ${
                input.trim() && !isLoading
                  ? "bg-gradient-to-r from-[#2eaadc] to-[#1c96c5] text-white hover:from-[#1c96c5] hover:to-[#1580a8] shadow-md"
                  : "bg-[#f7f6f3] text-[#a9a8a5] cursor-not-allowed"
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
          <p className="mt-2 text-xs text-[#a9a8a5] text-center">
            按 <kbd className="px-1.5 py-0.5 bg-[#f7f6f3] rounded text-xs mx-0.5">Enter</kbd> 发送，<kbd className="px-1.5 py-0.5 bg-[#f7f6f3] rounded text-xs mx-0.5">Shift+Enter</kbd> 换行
          </p>
        </div>
      )}
    </div>
  )
}

export default SidePanel
