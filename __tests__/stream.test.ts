import { describe, it, expect } from "vitest"
import { parseSSEChunk, extractDeltaContent, StreamInterruptedError } from "../lib/stream"

describe("parseSSEChunk", () => {
  it("parses standard SSE data lines", () => {
    const chunk = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
    const events = parseSSEChunk(chunk)
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('{"choices":[{"delta":{"content":"Hello"}}]}')
  })

  it("parses multiple SSE events in one chunk", () => {
    const chunk =
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choices":[{"delta":{"content":" there"}}]}\n\n'
    const events = parseSSEChunk(chunk)
    expect(events).toHaveLength(2)
  })

  it("ignores [DONE] signal", () => {
    const chunk = "data: [DONE]\n\n"
    const events = parseSSEChunk(chunk)
    expect(events).toHaveLength(0)
  })

  it("ignores comment lines starting with :", () => {
    const chunk = ': this is a comment\ndata: {"choices":[{"delta":{"content":"test"}}]}\n\n'
    const events = parseSSEChunk(chunk)
    expect(events).toHaveLength(1)
  })

  it("handles data without space after colon", () => {
    const chunk = 'data:{"choices":[{"delta":{"content":"test"}}]}\n\n'
    const events = parseSSEChunk(chunk)
    expect(events).toHaveLength(1)
  })

  it("handles empty chunk", () => {
    const events = parseSSEChunk("")
    expect(events).toHaveLength(0)
  })

  it("handles chunk with only newlines", () => {
    const events = parseSSEChunk("\n\n\n")
    expect(events).toHaveLength(0)
  })
})

describe("extractDeltaContent", () => {
  it("extracts content from valid JSON", () => {
    const data = '{"choices":[{"delta":{"content":"Hello world"}}]}'
    const content = extractDeltaContent(data)
    expect(content).toBe("Hello world")
  })

  it("returns empty string for JSON without content", () => {
    const data = '{"choices":[{"delta":{}}]}'
    const content = extractDeltaContent(data)
    expect(content).toBe("")
  })

  it("returns empty string for invalid JSON", () => {
    const data = "not valid json"
    const content = extractDeltaContent(data)
    expect(content).toBe("")
  })

  it("returns empty string for empty choices array", () => {
    const data = '{"choices":[]}'
    const content = extractDeltaContent(data)
    expect(content).toBe("")
  })

  it("handles partial JSON gracefully", () => {
    const data = '{"choices":[{"delta":{"content":"par'
    const content = extractDeltaContent(data)
    expect(content).toBe("")
  })
})

describe("StreamInterruptedError", () => {
  it("has correct name and message", () => {
    const error = new StreamInterruptedError("test message")
    expect(error.name).toBe("StreamInterruptedError")
    expect(error.message).toBe("test message")
  })

  it("has default message", () => {
    const error = new StreamInterruptedError()
    expect(error.message).toBe("Stream interrupted")
  })
})
