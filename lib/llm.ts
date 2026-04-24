import { Message, OpenAIConfig } from "./types"
import { readStream } from "./stream"

const NON_STREAM_TIMEOUT = 30000
const STREAM_TIMEOUT = 120000

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
  stream: boolean = false,
  maxTokens?: number
): string {
  return JSON.stringify({
    model: config.model || "gpt-4o",
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    temperature: 0.7,
    max_tokens: maxTokens || 1500,
    stream,
  })
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  }
}

function createTimeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), ms)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
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
  messages: Message[],
  maxTokens?: number
): Promise<string> {
  if (!config.apiKey || !config.baseURL) {
    throw new LLMError("请先配置 API 参数")
  }

  const url = buildApiUrl(config.baseURL)
  const { signal: timeoutSignal, clear: clearTimeout } = createTimeoutSignal(NON_STREAM_TIMEOUT)

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(config.apiKey),
      body: buildRequestBody(config, messages, false, maxTokens),
      signal: timeoutSignal,
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
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new LLMError("请求超时，请检查网络连接或稍后重试")
    }
    throw err
  } finally {
    clearTimeout()
  }
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
  const { signal: timeoutSignal, clear: clearTimeout } = createTimeoutSignal(STREAM_TIMEOUT)

  const combinedController = new AbortController()

  const onAbort = () => combinedController.abort()
  timeoutSignal.addEventListener("abort", onAbort)
  if (signal) {
    signal.addEventListener("abort", onAbort)
    if (signal.aborted) combinedController.abort()
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(config.apiKey),
      body: buildRequestBody(config, messages, true),
      signal: combinedController.signal,
    })

    if (!response.ok) {
      let errorMessage = `API 错误: ${response.status}`
      try {
        const errorData = await response.json()
        errorMessage = errorData.error?.message || errorMessage
      } catch {}
      throw new LLMError(errorMessage, response.status)
    }

    const rawText = await readStream(response, onChunk, combinedController.signal)

    return stripThinkTags(rawText)
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      if (timeoutSignal.aborted && !signal?.aborted) {
        throw new LLMError("请求超时，请检查网络连接或稍后重试")
      }
      throw new LLMError("请求已取消")
    }
    throw err
  } finally {
    clearTimeout()
    timeoutSignal.removeEventListener("abort", onAbort)
    if (signal) signal.removeEventListener("abort", onAbort)
  }
}

export async function testApiConnection(config: OpenAIConfig): Promise<{ success: boolean; message: string }> {
  if (!config.apiKey || !config.baseURL) {
    return { success: false, message: "请先填写 API 地址和密钥" }
  }
  try {
    await callLLM(config, [
      { id: "", role: "user", content: "Hi", timestamp: Date.now(), visible: true }
    ], 5)
    return { success: true, message: `连接成功，模型: ${config.model}` }
  } catch (err) {
    return {
      success: false,
      message: err instanceof LLMError ? err.message : "连接失败，请检查配置"
    }
  }
}
