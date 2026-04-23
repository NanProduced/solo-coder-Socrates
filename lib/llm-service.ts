import { OpenAIConfig, Message, ConversationMode, DEFAULT_OPENAI_CONFIG } from "./types"

export interface LLMStreamChunk {
  content: string
  done: boolean
}

export interface LLMResponse {
  content: string
  mode: ConversationMode
  isSingleQuestion: boolean
  validation: {
    passed: boolean
    issues: string[]
  }
}

export type StreamCallback = (chunk: LLMStreamChunk) => void

export interface ConversationOptions {
  mode: ConversationMode
  temperature?: number
  maxTokens?: number
}

const SINGLE_QUESTION_PATTERNS = [
  /^[^?]*\?[^?]*$/,
  /^[^？]*？[^？]*$/,
]

const MULTIPLE_QUESTION_PATTERNS = [
  /\?[^?]*\?/,
  /？[^？]*？/,
  /[？?].*[？?]/,
]

export function stripThinkTags(content: string): string {
  return content
    .replace(/<think[\s\S]*?<\/think>/g, "")
    .replace(/<think[\s\S]*$/g, "")
    .trim()
}

export function countQuestions(content: string): number {
  const cleaned = stripThinkTags(content)
  let count = 0
  for (const char of cleaned) {
    if (char === "?" || char === "？") {
      count++
    }
  }
  return count
}

export function isValidSingleQuestion(content: string): boolean {
  const cleaned = stripThinkTags(content)
  if (!cleaned) return false

  const questionCount = countQuestions(cleaned)

  if (questionCount === 0) {
    return false
  }

  if (questionCount > 1) {
    return false
  }

  const hasMultipleMarkers = MULTIPLE_QUESTION_PATTERNS.some(pattern => pattern.test(cleaned))
  if (hasMultipleMarkers) {
    return false
  }

  return true
}

export function isSummaryResponse(content: string): boolean {
  const cleaned = stripThinkTags(content).toLowerCase()

  const summaryMarkers = [
    "总结",
    "核心",
    "关键",
    "要点",
    "主要",
    "概括",
    "归纳",
    "summary",
    "key points",
    "main points",
    "in summary",
    "to summarize",
  ]

  const hasSummaryMarker = summaryMarkers.some(marker => cleaned.includes(marker))

  const questionCount = countQuestions(cleaned)

  return hasSummaryMarker || questionCount === 0
}

export function validateResponse(content: string, mode: ConversationMode): {
  passed: boolean
  issues: string[]
  validatedContent: string
} {
  const issues: string[] = []
  let validatedContent = stripThinkTags(content)

  if (!validatedContent) {
    issues.push("响应内容为空")
    return { passed: false, issues, validatedContent }
  }

  if (mode === "single_question") {
    const questionCount = countQuestions(validatedContent)

    if (questionCount === 0) {
      issues.push("普通对话模式下需要提出一个问题")
    } else if (questionCount > 1) {
      issues.push(`检测到 ${questionCount} 个问题，普通对话模式只能提出一个问题`)
      validatedContent = extractFirstQuestion(validatedContent)
    }
  }

  if (mode === "summary") {
    const questionCount = countQuestions(validatedContent)
    if (questionCount > 0) {
      issues.push("总结模式下不应提出新问题")
      validatedContent = removeTrailingQuestions(validatedContent)
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    validatedContent,
  }
}

export function extractFirstQuestion(content: string): string {
  const cleaned = stripThinkTags(content)

  const questionEndIndex = Math.max(
    cleaned.indexOf("?"),
    cleaned.indexOf("？")
  )

  if (questionEndIndex === -1) {
    return cleaned
  }

  const sentenceEndMarkers = ["。", "！", "!", ".", "\n", "\n\n"]
  let sentenceStart = 0

  for (let i = questionEndIndex - 1; i >= 0; i--) {
    const char = cleaned[i]
    if (sentenceEndMarkers.includes(char)) {
      sentenceStart = i + 1
      break
    }
  }

  return cleaned.slice(sentenceStart, questionEndIndex + 1).trim()
}

export function removeTrailingQuestions(content: string): string {
  const cleaned = stripThinkTags(content)

  const lastQuestionMark = Math.max(
    cleaned.lastIndexOf("?"),
    cleaned.lastIndexOf("？")
  )

  if (lastQuestionMark === -1) {
    return cleaned
  }

  const beforeQuestions = cleaned.slice(0, lastQuestionMark)

  const lastPeriod = Math.max(
    beforeQuestions.lastIndexOf("。"),
    beforeQuestions.lastIndexOf("！"),
    beforeQuestions.lastIndexOf("!"),
    beforeQuestions.lastIndexOf(".")
  )

  if (lastPeriod === -1) {
    return cleaned
  }

  return cleaned.slice(0, lastPeriod + 1).trim()
}

export function buildSystemPrompt(mode: ConversationMode): string {
  const basePrompt = `你是苏格拉底，一位伟大的哲学家和导师。你的教学方法是通过提问来引导学生自己发现真理，而不是直接给出答案。`

  if (mode === "single_question") {
    return basePrompt + `

## 严格遵守的核心规则
1. **一次只问一个问题** - 这是最重要的规则。无论什么情况，每轮回复只能提出一个问题。
2. **禁止连续提问** - 不要使用"或者"、"还是"、"以及"等连接词提出多个问题。
3. **不要同时问多个方面** - 专注于一个核心点进行提问。

## 对话流程
1. 根据用户正在阅读的文档，提出一个苏格拉底式的引导问题
2. 根据用户的回答，判断理解程度，调整下一个问题
3. 持续深入，直到用户真正理解核心概念

## 回答要求
- 像苏格拉底那样对话，使用温和的语气
- 提出的问题要能激发批判性思考
- **重要：每轮只能提出一个问题**
- 不要说教，要引导
- 如果用户正在阅读的是中文文档，请用中文提问和对话
- 如果用户正在阅读的是英文文档，可以用英文或中文对话

## 错误示例（禁止）
- "你觉得这篇文章的核心论点是什么？它的论证是否充分？" - 这是两个问题
- "你认为作者的观点对吗？或者你有不同的看法？" - 这是两个问题

## 正确示例
- "你觉得这篇文章试图告诉我们什么？"
- "你对这个主题有什么预先的理解吗？"
- "这份文档的核心论点可能是什么？"`
  }

  if (mode === "summary") {
    return basePrompt + `

## 总结模式规则
1. **只提供总结，不要提问** - 这是总结模式，用户需要的是清晰的总结，而不是新的问题。
2. **结构化总结** - 使用清晰的结构呈现要点。
3. **不要追问** - 总结完成后，不要提出新的问题。

## 总结要求
请提供一个简洁、清晰的总结，包括：
1. 文档的核心主题
2. 我们讨论过的关键点
3. 主要的理解收获

## 格式建议
- 使用小标题或项目符号组织内容
- 语言要清晰、简洁
- **不要在总结末尾提出新的问题**`
  }

  return basePrompt
}

export function buildFullSystemPrompt(
  mode: ConversationMode,
  existingSystemContent?: string
): string {
  const basePrompt = buildSystemPrompt(mode)
  
  if (existingSystemContent && existingSystemContent.trim()) {
    return basePrompt + "\n\n" + existingSystemContent
  }
  
  return basePrompt
}

export async function callLLMStream(
  config: OpenAIConfig,
  messages: Message[],
  options: ConversationOptions,
  onStream?: StreamCallback
): Promise<LLMResponse> {
  const { mode, temperature = 0.7, maxTokens = 1500 } = options

  if (!config.apiKey || !config.baseURL) {
    throw new Error("请先配置 API 参数")
  }

  const baseURL = config.baseURL.endsWith("/") ? config.baseURL : config.baseURL + "/"
  const url = baseURL + "chat/completions"

  const existingSystemMessage = messages.find(m => m.role === "system")
  
  const fullSystemPrompt = buildFullSystemPrompt(
    mode,
    existingSystemMessage?.content
  )

  const nonSystemMessages = messages.filter(m => m.role !== "system")

  const apiMessages = nonSystemMessages.map(m => ({
    role: m.role,
    content: m.content
  }))

  const requestBody = {
    model: config.model || "gpt-4o",
    messages: [
      { role: "system", content: fullSystemPrompt },
      ...apiMessages
    ],
    temperature,
    max_tokens: maxTokens,
    stream: true,
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
      "Accept": "text/event-stream",
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error?.message || `API 错误: ${response.status}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error("无法获取响应流")
  }

  const decoder = new TextDecoder("utf-8")
  let fullContent = ""
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6)

          if (data === "[DONE]") {
            if (onStream) {
              onStream({ content: "", done: true })
            }
            continue
          }

          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices[0]?.delta
            const content = delta?.content || ""

            if (content) {
              fullContent += content
              if (onStream) {
                onStream({ content, done: false })
              }
            }
          } catch {
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  const strippedContent = stripThinkTags(fullContent)
  const validation = validateResponse(strippedContent, mode)

  return {
    content: validation.validatedContent,
    mode,
    isSingleQuestion: mode === "single_question" && countQuestions(validation.validatedContent) === 1,
    validation,
  }
}

export async function callLLMNonStream(
  config: OpenAIConfig,
  messages: Message[],
  options: ConversationOptions
): Promise<LLMResponse> {
  const { mode, temperature = 0.7, maxTokens = 1500 } = options

  if (!config.apiKey || !config.baseURL) {
    throw new Error("请先配置 API 参数")
  }

  const baseURL = config.baseURL.endsWith("/") ? config.baseURL : config.baseURL + "/"
  const url = baseURL + "chat/completions"

  const existingSystemMessage = messages.find(m => m.role === "system")
  
  const fullSystemPrompt = buildFullSystemPrompt(
    mode,
    existingSystemMessage?.content
  )

  const nonSystemMessages = messages.filter(m => m.role !== "system")

  const apiMessages = nonSystemMessages.map(m => ({
    role: m.role,
    content: m.content
  }))

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || "gpt-4o",
      messages: [
        { role: "system", content: fullSystemPrompt },
        ...apiMessages
      ],
      temperature,
      max_tokens: maxTokens,
    })
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error?.message || `API 错误: ${response.status}`)
  }

  const data = await response.json()
  const fullContent = data.choices[0]?.message?.content || ""

  const strippedContent = stripThinkTags(fullContent)
  const validation = validateResponse(strippedContent, mode)

  return {
    content: validation.validatedContent,
    mode,
    isSingleQuestion: mode === "single_question" && countQuestions(validation.validatedContent) === 1,
    validation,
  }
}
