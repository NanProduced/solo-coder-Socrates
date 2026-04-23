import { describe, it, expect, vi, beforeEach } from "vitest"
import { callLLM, callLLMStream, LLMError } from "../lib/llm"
import { OpenAIConfig, Message } from "../lib/types"

const mockConfig: OpenAIConfig = {
  baseURL: "https://api.example.com/v1",
  apiKey: "test-key",
  model: "gpt-4o",
}

const mockMessages: Message[] = [
  { id: "1", role: "user", content: "Hello", timestamp: Date.now(), visible: true },
]

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("callLLM", () => {
  it("throws LLMError when config is missing", async () => {
    const badConfig = { baseURL: "", apiKey: "", model: "" }
    await expect(callLLM(badConfig, mockMessages)).rejects.toThrow(LLMError)
  })

  it("makes successful non-streaming call", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Hello back!" } }],
      }),
    }
    vi.spyOn(global, "fetch").mockResolvedValue(mockResponse as any)

    const result = await callLLM(mockConfig, mockMessages)
    expect(result).toBe("Hello back!")

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      })
    )
  })

  it("strips think tags from response", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "<think\nreasoning here\n</think\n\nActual response",
            },
          },
        ],
      }),
    }
    vi.spyOn(global, "fetch").mockResolvedValue(mockResponse as any)

    const result = await callLLM(mockConfig, mockMessages)
    expect(result).not.toContain("reasoning")
  })

  it("strips incomplete think tags from response", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "Some text<think\nstill thinking",
            },
          },
        ],
      }),
    }
    vi.spyOn(global, "fetch").mockResolvedValue(mockResponse as any)

    const result = await callLLM(mockConfig, mockMessages)
    expect(result).not.toContain("think")
    expect(result).toContain("Some text")
  })

  it("throws LLMError on API error", async () => {
    const mockResponse = {
      ok: false,
      status: 429,
      json: async () => ({
        error: { message: "Rate limit exceeded" },
      }),
    }
    vi.spyOn(global, "fetch").mockResolvedValue(mockResponse as any)

    await expect(callLLM(mockConfig, mockMessages)).rejects.toThrow(LLMError)
    await expect(callLLM(mockConfig, mockMessages)).rejects.toThrow(
      "Rate limit exceeded"
    )
  })

  it("handles non-JSON error response", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("Not JSON")
      },
    }
    vi.spyOn(global, "fetch").mockResolvedValue(mockResponse as any)

    await expect(callLLM(mockConfig, mockMessages)).rejects.toThrow("API 错误: 500")
  })

  it("handles empty response content", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "" } }],
      }),
    }
    vi.spyOn(global, "fetch").mockResolvedValue(mockResponse as any)

    const result = await callLLM(mockConfig, mockMessages)
    expect(result).toBe("")
  })

  it("handles missing choices in response", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({}),
    }
    vi.spyOn(global, "fetch").mockResolvedValue(mockResponse as any)

    const result = await callLLM(mockConfig, mockMessages)
    expect(result).toBe("")
  })

  it("normalizes baseURL with trailing slash", async () => {
    const configNoSlash = { ...mockConfig, baseURL: "https://api.example.com/v1" }
    const mockResponse = {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    }
    vi.spyOn(global, "fetch").mockResolvedValue(mockResponse as any)

    await callLLM(configNoSlash, mockMessages)
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.anything()
    )
  })
})

describe("callLLMStream", () => {
  it("throws LLMError when config is missing", async () => {
    const badConfig = { baseURL: "", apiKey: "", model: "" }
    await expect(
      callLLMStream(badConfig, mockMessages, vi.fn())
    ).rejects.toThrow(LLMError)
  })

  it("sends stream: true in request body", async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'
          )
        )
        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      },
    })

    const mockResponse = {
      ok: true,
      body: stream,
    }
    vi.spyOn(global, "fetch").mockResolvedValue(mockResponse as any)

    await callLLMStream(mockConfig, mockMessages, vi.fn())

    const fetchCall = (fetch as any).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.stream).toBe(true)
  })

  it("calls onChunk for each content delta", async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n'
          )
        )
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"world!"}}]}\n\n'
          )
        )
        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      },
    })

    const mockResponse = {
      ok: true,
      body: stream,
    }
    vi.spyOn(global, "fetch").mockResolvedValue(mockResponse as any)

    const onChunk = vi.fn()
    const result = await callLLMStream(mockConfig, mockMessages, onChunk)

    expect(onChunk).toHaveBeenCalledWith("Hello ")
    expect(onChunk).toHaveBeenCalledWith("world!")
    expect(result).toContain("Hello ")
    expect(result).toContain("world!")
  })

  it("throws LLMError on non-ok response", async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Unauthorized" } }),
    }
    vi.spyOn(global, "fetch").mockResolvedValue(mockResponse as any)

    await expect(
      callLLMStream(mockConfig, mockMessages, vi.fn())
    ).rejects.toThrow("Unauthorized")
  })

  it("respects AbortSignal", async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"Start"}}]}\n\n'
          )
        )
      },
    })

    const mockResponse = {
      ok: true,
      body: stream,
    }
    vi.spyOn(global, "fetch").mockResolvedValue(mockResponse as any)

    const abortController = new AbortController()
    abortController.abort()

    const onChunk = vi.fn()
    const result = await callLLMStream(
      mockConfig,
      mockMessages,
      onChunk,
      abortController.signal
    )

    expect(typeof result).toBe("string")
  })
})
