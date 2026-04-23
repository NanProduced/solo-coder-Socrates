import { Message, OpenAIConfig } from "./types"
import { readStream } from "./stream"

function stripThinkTags(content: string): string {
  return content
    .replace(/<think[\s\S]*?<\/think>/g, "")
    .replace(/<think[\s\S]*$/g, "")
    .trim()
}

function buildApiUrl(baseURL: string): string {
  const normalized = baseURL.endsWith("/") ? baseURL : baseURL + "/"
  return normalized + "chat/completions"
}

function buildRequestBody(
  config: OpenAIConfig,
  messages: Message[],
  stream: boolean = false
): string {
  return JSON.stringify({
    model: config.model || "gpt-4o",
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    temperature: 0.7,
    max_tokens: 1500,
    stream,
  })
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  }
}

export class LLMError extends Error {
  constructor(
    message: string,
    public statusCode?: number
  ) {
    super(message)
    this.name = "LLMError"
  }
}

export async function callLLM(
  config: OpenAIConfig,
  messages: Message[]
): Promise<string> {
  if (!config.apiKey || !config.baseURL) {
    throw new LLMError("请先配置 API 参数")
  }

  const url = buildApiUrl(config.baseURL)
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(config.apiKey),
    body: buildRequestBody(config, messages, false),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new LLMError(
      errorData.error?.message || `API 错误: ${response.status}`,
      response.status
    )
  }

  const data = await response.json()
  let content = data.choices?.[0]?.message?.content || ""
  content = stripThinkTags(content)

  return content
}

export async function callLLMStream(
  config: OpenAIConfig,
  messages: Message[],
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  if (!config.apiKey || !config.baseURL) {
    throw new LLMError("请先配置 API 参数")
  }

  const url = buildApiUrl(config.baseURL)
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(config.apiKey),
    body: buildRequestBody(config, messages, true),
    signal,
  })

  if (!response.ok) {
    let errorMessage = `API 错误: ${response.status}`
    try {
      const errorData = await response.json()
      errorMessage = errorData.error?.message || errorMessage
    } catch {}
    throw new LLMError(errorMessage, response.status)
  }

  const rawText = await readStream(response, onChunk, signal)

  return stripThinkTags(rawText)
}
