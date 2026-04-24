interface SSEEvent {
  data: string
}

export function parseSSEChunk(chunk: string): SSEEvent[] {
  const events: SSEEvent[] = []
  const lines = chunk.split("\n")

  let currentData = ""
  let hasData = false

  for (const line of lines) {
    if (line.startsWith(":")) {
      continue
    }

    if (line.startsWith("data: ")) {
      const data = line.slice(6)
      if (data === "[DONE]") {
        continue
      }
      if (hasData) {
        currentData += "\n"
      }
      currentData += data
      hasData = true
    } else if (line.startsWith("data:")) {
      const data = line.slice(5)
      if (data === "[DONE]") {
        continue
      }
      if (hasData) {
        currentData += "\n"
      }
      currentData += data
      hasData = true
    } else if (line === "") {
      if (hasData) {
        events.push({ data: currentData })
        currentData = ""
        hasData = false
      }
    } else {
      if (hasData) {
        currentData += "\n"
      }
      currentData += line
      hasData = true
    }
  }

  if (hasData) {
    events.push({ data: currentData })
  }

  return events
}

export function extractDeltaContent(data: string): string {
  try {
    const parsed = JSON.parse(data)
    return parsed.choices?.[0]?.delta?.content || ""
  } catch {
    return ""
  }
}

export class StreamInterruptedError extends Error {
  constructor(message: string = "Stream interrupted") {
    super(message)
    this.name = "StreamInterruptedError"
  }
}

export async function readStream(
  response: Response,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new StreamInterruptedError("No readable stream available")
  }

  const decoder = new TextDecoder()
  let accumulated = ""
  let buffer = ""

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel()
        break
      }

      const { done, value } = await reader.read()

      if (done) {
        if (buffer.trim()) {
          const events = parseSSEChunk(buffer)
          for (const event of events) {
            const content = extractDeltaContent(event.data)
            if (content) {
              accumulated += content
              onChunk(content)
            }
          }
        }
        break
      }

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      let chunkText = ""
      for (const line of lines) {
        if (line.startsWith(":")) continue
        if (line.startsWith("data: ")) {
          const data = line.slice(6)
          if (data === "[DONE]") continue
          const content = extractDeltaContent(data)
          if (content) {
            chunkText += content
          }
        } else if (line.startsWith("data:")) {
          const data = line.slice(5)
          if (data === "[DONE]") continue
          const content = extractDeltaContent(data)
          if (content) {
            chunkText += content
          }
        }
      }

      if (chunkText) {
        accumulated += chunkText
        onChunk(chunkText)
      }
    }
  } catch (error) {
    if (signal?.aborted) {
      return accumulated
    }
    if (error instanceof TypeError && error.message.includes("network")) {
      throw new StreamInterruptedError("Network error during streaming")
    }
    throw error
  } finally {
    reader.releaseLock()
  }

  return accumulated
}
