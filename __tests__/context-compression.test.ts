import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  analyzeMessagesForCompression,
  buildSummaryPrompt,
  createSummaryMessage,
  estimateMessageTokens,
  CONTEXT_COMPRESSION_CONFIG,
  CONTEXT_COMPRESSION_SUMMARY_PROMPT,
} from "../lib/context-compression"
import { Message } from "../lib/types"

const createMessage = (
  role: "user" | "assistant" | "system",
  content: string,
  options: { visible?: boolean; isSummary?: boolean } = {}
): Message => ({
  id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  role,
  content,
  timestamp: Date.now(),
  visible: options.visible ?? true,
  isSummary: options.isSummary,
})

const createConversationRound = (
  userContent: string,
  assistantContent: string
): Message[] => [
  createMessage("user", userContent),
  createMessage("assistant", assistantContent),
]

describe("analyzeMessagesForCompression", () => {
  it("returns shouldCompress: false when message count is below threshold", () => {
    const messages: Message[] = [
      createMessage("system", "System prompt", { visible: false }),
      ...createConversationRound("User 1", "Assistant 1"),
      ...createConversationRound("User 2", "Assistant 2"),
    ]

    const result = analyzeMessagesForCompression(messages, {
      compressionTriggerRounds: 5,
      recentRoundsToKeep: 2,
    })

    expect(result.shouldCompress).toBe(false)
    expect(result.messagesForLLM).toEqual(messages)
  })

  it("returns shouldCompress: true when message count exceeds threshold", () => {
    const systemMessage = createMessage("system", "System prompt", { visible: false })
    const hiddenMessage = createMessage("user", "Hidden instruction", { visible: false })

    const conversationMessages: Message[] = []
    for (let i = 1; i <= 10; i++) {
      conversationMessages.push(...createConversationRound(`User ${i}`, `Assistant ${i}`))
    }

    const messages = [systemMessage, hiddenMessage, ...conversationMessages]

    const result = analyzeMessagesForCompression(messages, {
      compressionTriggerRounds: 8,
      recentRoundsToKeep: 3,
    })

    expect(result.shouldCompress).toBe(true)
    expect(result.preservedMessages).toContain(systemMessage)
    expect(result.preservedMessages).toContain(hiddenMessage)
  })

  it("preserves system messages regardless of compression", () => {
    const systemMessage = createMessage("system", "System prompt", { visible: false })

    const conversationMessages: Message[] = []
    for (let i = 1; i <= 10; i++) {
      conversationMessages.push(...createConversationRound(`User ${i}`, `Assistant ${i}`))
    }

    const messages = [systemMessage, ...conversationMessages]

    const result = analyzeMessagesForCompression(messages, {
      compressionTriggerRounds: 5,
      recentRoundsToKeep: 2,
    })

    expect(result.preservedMessages).toContain(systemMessage)
    expect(result.messagesForLLM).toContain(systemMessage)
  })

  it("preserves hidden messages (visible: false)", () => {
    const systemMessage = createMessage("system", "System prompt", { visible: false })
    const hiddenUserMessage = createMessage("user", "Internal instruction", { visible: false })

    const conversationMessages: Message[] = []
    for (let i = 1; i <= 10; i++) {
      conversationMessages.push(...createConversationRound(`User ${i}`, `Assistant ${i}`))
    }

    const messages = [systemMessage, hiddenUserMessage, ...conversationMessages]

    const result = analyzeMessagesForCompression(messages, {
      compressionTriggerRounds: 5,
      recentRoundsToKeep: 2,
    })

    expect(result.preservedMessages).toContain(hiddenUserMessage)
    expect(result.messagesForLLM).toContain(hiddenUserMessage)
  })

  it("preserves existing summary messages", () => {
    const systemMessage = createMessage("system", "System prompt", { visible: false })
    const existingSummary = createMessage(
      "user",
      "--- 对话历史摘要 ---\n之前的对话总结\n--- 摘要结束 ---",
      { isSummary: true }
    )

    const conversationMessages: Message[] = []
    for (let i = 1; i <= 10; i++) {
      conversationMessages.push(...createConversationRound(`User ${i}`, `Assistant ${i}`))
    }

    const messages = [systemMessage, existingSummary, ...conversationMessages]

    const result = analyzeMessagesForCompression(messages, {
      compressionTriggerRounds: 5,
      recentRoundsToKeep: 2,
    })

    expect(result.preservedMessages).toContain(existingSummary)
    expect(result.messagesForLLM).toContain(existingSummary)
  })

  it("keeps only recent N rounds when compressing", () => {
    const conversationMessages: Message[] = []
    for (let i = 1; i <= 10; i++) {
      conversationMessages.push(...createConversationRound(`User ${i}`, `Assistant ${i}`))
    }

    const result = analyzeMessagesForCompression(conversationMessages, {
      compressionTriggerRounds: 5,
      recentRoundsToKeep: 3,
    })

    expect(result.shouldCompress).toBe(true)
    expect(result.recentMessages.length).toBe(6)

    const recentUserMessages = result.recentMessages.filter((m) => m.role === "user")
    expect(recentUserMessages).toHaveLength(3)
    expect(recentUserMessages[0].content).toBe("User 8")
    expect(recentUserMessages[1].content).toBe("User 9")
    expect(recentUserMessages[2].content).toBe("User 10")
  })

  it("correctly identifies messages to compress", () => {
    const conversationMessages: Message[] = []
    for (let i = 1; i <= 10; i++) {
      conversationMessages.push(...createConversationRound(`User ${i}`, `Assistant ${i}`))
    }

    const result = analyzeMessagesForCompression(conversationMessages, {
      compressionTriggerRounds: 5,
      recentRoundsToKeep: 3,
    })

    expect(result.messagesToCompress.length).toBe(14)

    const compressedUserMessages = result.messagesToCompress.filter((m) => m.role === "user")
    expect(compressedUserMessages).toHaveLength(7)
    expect(compressedUserMessages[0].content).toBe("User 1")
    expect(compressedUserMessages[6].content).toBe("User 7")
  })

  it("handles incomplete last round (user message without assistant response)", () => {
    const conversationMessages: Message[] = []
    for (let i = 1; i <= 9; i++) {
      conversationMessages.push(...createConversationRound(`User ${i}`, `Assistant ${i}`))
    }
    conversationMessages.push(createMessage("user", "User 10 (no response yet)"))

    const result = analyzeMessagesForCompression(conversationMessages, {
      compressionTriggerRounds: 5,
      recentRoundsToKeep: 3,
    })

    expect(result.shouldCompress).toBe(true)
    expect(result.recentMessages.length).toBe(5)

    const recentMessages = result.recentMessages
    expect(recentMessages[recentMessages.length - 1].content).toBe("User 10 (no response yet)")
  })

  it("uses default config values when options not provided", () => {
    const conversationMessages: Message[] = []
    const roundsNeeded = CONTEXT_COMPRESSION_CONFIG.COMPRESSION_TRIGGER_ROUNDS + 1
    for (let i = 1; i <= roundsNeeded; i++) {
      conversationMessages.push(...createConversationRound(`User ${i}`, `Assistant ${i}`))
    }

    const result = analyzeMessagesForCompression(conversationMessages)

    expect(result.shouldCompress).toBe(true)
  })
})

describe("buildSummaryPrompt", () => {
  it("builds prompt with formatted conversation history", () => {
    const messagesToCompress: Message[] = [
      createMessage("user", "What is recursion?"),
      createMessage("assistant", "Recursion is when a function calls itself."),
      createMessage("user", "Can you give an example?"),
      createMessage("assistant", "Factorial calculation is a classic example."),
    ]

    const prompt = buildSummaryPrompt(messagesToCompress)

    expect(prompt).toContain(CONTEXT_COMPRESSION_SUMMARY_PROMPT)
    expect(prompt).toContain("用户: What is recursion?")
    expect(prompt).toContain("苏格拉底: Recursion is when a function calls itself.")
    expect(prompt).toContain("用户: Can you give an example?")
    expect(prompt).toContain("苏格拉底: Factorial calculation is a classic example.")
  })
})

describe("createSummaryMessage", () => {
  it("creates a properly formatted summary message", () => {
    const summaryContent = "用户询问了递归的概念，已理解递归的基本定义和阶乘示例。"
    const originalMessages: Message[] = [
      createMessage("user", "What is recursion?"),
      createMessage("assistant", "Recursion is when a function calls itself."),
    ]

    const summaryMessage = createSummaryMessage(summaryContent, originalMessages)

    expect(summaryMessage.role).toBe(CONTEXT_COMPRESSION_CONFIG.SUMMARY_MESSAGE_ROLE)
    expect(summaryMessage.visible).toBe(true)
    expect(summaryMessage.isSummary).toBe(true)
    expect(summaryMessage.content).toContain("--- 对话历史摘要 ---")
    expect(summaryMessage.content).toContain(summaryContent)
    expect(summaryMessage.content).toContain("--- 摘要结束 ---")
  })

  it("uses earliest timestamp from original messages", () => {
    const earlyTimestamp = Date.now() - 86400000
    const lateTimestamp = Date.now()

    const originalMessages: Message[] = [
      { ...createMessage("user", "Early message"), timestamp: earlyTimestamp },
      { ...createMessage("assistant", "Late response"), timestamp: lateTimestamp },
    ]

    const summaryMessage = createSummaryMessage("Summary", originalMessages)

    expect(summaryMessage.timestamp).toBe(earlyTimestamp)
  })
})

describe("estimateMessageTokens", () => {
  it("estimates token count for messages", () => {
    const messages: Message[] = [
      createMessage("system", "You are a helpful assistant.", { visible: false }),
      createMessage("user", "Hello, how are you?"),
      createMessage("assistant", "I'm fine, thank you!"),
    ]

    const estimated = estimateMessageTokens(messages)

    expect(typeof estimated).toBe("number")
    expect(estimated).toBeGreaterThan(0)
  })

  it("handles empty message array", () => {
    const estimated = estimateMessageTokens([])

    expect(estimated).toBeGreaterThan(0)
  })
})

describe("integration scenarios", () => {
  it("correctly handles mixed message types in compression analysis", () => {
    const systemMessage = createMessage("system", "System prompt", { visible: false })
    const hiddenInstruction = createMessage("user", "Internal instruction", { visible: false })
    const existingSummary = createMessage(
      "user",
      "--- 对话历史摘要 ---\nOld summary\n--- 摘要结束 ---",
      { isSummary: true }
    )

    const conversationMessages: Message[] = []
    for (let i = 1; i <= 10; i++) {
      conversationMessages.push(...createConversationRound(`User ${i}`, `Assistant ${i}`))
    }

    const messages = [
      systemMessage,
      hiddenInstruction,
      existingSummary,
      ...conversationMessages,
    ]

    const result = analyzeMessagesForCompression(messages, {
      compressionTriggerRounds: 5,
      recentRoundsToKeep: 3,
    })

    expect(result.shouldCompress).toBe(true)

    expect(result.preservedMessages).toContain(systemMessage)
    expect(result.preservedMessages).toContain(hiddenInstruction)
    expect(result.preservedMessages).toContain(existingSummary)

    expect(result.messagesForLLM).toContain(systemMessage)
    expect(result.messagesForLLM).toContain(hiddenInstruction)
    expect(result.messagesForLLM).toContain(existingSummary)

    const firstCompressedUser = result.messagesToCompress.find((m) => m.role === "user")
    expect(firstCompressedUser?.content).toBe("User 1")

    const lastRecentUser = result.recentMessages
      .filter((m) => m.role === "user")
      .pop()
    expect(lastRecentUser?.content).toBe("User 10")
  })

  it("does not compress when exactly at threshold", () => {
    const conversationMessages: Message[] = []
    for (let i = 1; i <= 5; i++) {
      conversationMessages.push(...createConversationRound(`User ${i}`, `Assistant ${i}`))
    }

    const result = analyzeMessagesForCompression(conversationMessages, {
      compressionTriggerRounds: 5,
      recentRoundsToKeep: 2,
    })

    expect(result.shouldCompress).toBe(false)
  })

  it("compresses when one over threshold", () => {
    const conversationMessages: Message[] = []
    for (let i = 1; i <= 6; i++) {
      conversationMessages.push(...createConversationRound(`User ${i}`, `Assistant ${i}`))
    }

    const result = analyzeMessagesForCompression(conversationMessages, {
      compressionTriggerRounds: 5,
      recentRoundsToKeep: 2,
    })

    expect(result.shouldCompress).toBe(true)
  })
})
