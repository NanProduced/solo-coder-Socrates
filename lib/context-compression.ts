import { Message, OpenAIConfig } from "./types"
import { callLLM } from "./llm"

export const CONTEXT_COMPRESSION_CONFIG = {
  COMPRESSION_TRIGGER_ROUNDS: 8,
  RECENT_ROUNDS_TO_KEEP: 3,
  SUMMARY_MESSAGE_ROLE: "user" as const,
}

export const CONTEXT_COMPRESSION_SUMMARY_PROMPT = `你是一个对话历史摘要生成器。请将以下对话历史总结为一份简洁的摘要，保留以下关键信息：

1. **已达成的理解**：用户已经理解了哪些核心概念
2. **未完成事项**：还有哪些问题待回答、哪些知识点待澄清
3. **对话脉络**：简要描述讨论的主要方向和进展
4. **关键约束**：如果有明确的约束或目标，请保留

要求：
- 摘要长度控制在 100-200 字
- 语言要简洁、信息密度高
- 不要添加原文没有的信息
- 使用中文输出

以下是对话历史：`

export interface CompressionResult {
  shouldCompress: boolean
  messagesForLLM: Message[]
  messagesToCompress: Message[]
  preservedMessages: Message[]
  recentMessages: Message[]
}

export function analyzeMessagesForCompression(
  messages: Message[],
  options: {
    compressionTriggerRounds?: number
    recentRoundsToKeep?: number
  } = {}
): CompressionResult {
  const {
    compressionTriggerRounds = CONTEXT_COMPRESSION_CONFIG.COMPRESSION_TRIGGER_ROUNDS,
    recentRoundsToKeep = CONTEXT_COMPRESSION_CONFIG.RECENT_ROUNDS_TO_KEEP,
  } = options

  const systemMessages: Message[] = []
  const hiddenMessages: Message[] = []
  const summaryMessages: Message[] = []
  const conversationRounds: Message[][] = []

  let currentRound: Message[] = []

  for (const msg of messages) {
    if (msg.role === "system") {
      systemMessages.push(msg)
      continue
    }

    if (!msg.visible) {
      hiddenMessages.push(msg)
      continue
    }

    if (msg.isSummary) {
      summaryMessages.push(msg)
      continue
    }

    if (msg.role === "user") {
      if (currentRound.length > 0) {
        conversationRounds.push(currentRound)
      }
      currentRound = [msg]
    } else if (msg.role === "assistant") {
      currentRound.push(msg)
    }
  }

  if (currentRound.length > 0) {
    conversationRounds.push(currentRound)
  }

  const totalRounds = conversationRounds.length

  if (totalRounds <= compressionTriggerRounds) {
    return {
      shouldCompress: false,
      messagesForLLM: messages,
      messagesToCompress: [],
      preservedMessages: [...systemMessages, ...hiddenMessages, ...summaryMessages],
      recentMessages: messages,
    }
  }

  const roundsToCompressCount = totalRounds - recentRoundsToKeep
  const roundsToCompress = conversationRounds.slice(0, roundsToCompressCount)
  const recentRounds = conversationRounds.slice(roundsToCompressCount)

  const messagesToCompress = roundsToCompress.flat()
  const recentMessages = recentRounds.flat()

  const messagesForLLM = [
    ...systemMessages,
    ...hiddenMessages,
    ...summaryMessages,
    ...recentMessages,
  ]

  const preservedMessages = [
    ...systemMessages,
    ...hiddenMessages,
    ...summaryMessages,
  ]

  return {
    shouldCompress: true,
    messagesForLLM,
    messagesToCompress,
    preservedMessages,
    recentMessages,
  }
}

export function buildSummaryPrompt(messagesToCompress: Message[]): string {
  const formattedHistory = messagesToCompress
    .map((m) => {
      const speaker = m.role === "user" ? "用户" : "苏格拉底"
      return `${speaker}: ${m.content}`
    })
    .join("\n\n")

  return CONTEXT_COMPRESSION_SUMMARY_PROMPT + "\n\n" + formattedHistory
}

export function createSummaryMessage(
  summaryContent: string,
  originalMessages: Message[]
): Message {
  const earliestTimestamp = Math.min(...originalMessages.map((m) => m.timestamp))

  return {
    id: "summary-" + Date.now().toString() + Math.random().toString(36).slice(2, 9),
    role: CONTEXT_COMPRESSION_CONFIG.SUMMARY_MESSAGE_ROLE,
    content: `--- 对话历史摘要 ---\n${summaryContent}\n--- 摘要结束 ---`,
    timestamp: earliestTimestamp,
    visible: false,
    isSummary: true,
  }
}

export async function compressMessages(
  config: OpenAIConfig,
  messages: Message[],
  options: {
    compressionTriggerRounds?: number
    recentRoundsToKeep?: number
  } = {}
): Promise<{
  compressed: boolean
  messages: Message[]
  summaryContent?: string
}> {
  const analysis = analyzeMessagesForCompression(messages, options)

  if (!analysis.shouldCompress) {
    return {
      compressed: false,
      messages,
    }
  }

  try {
    const summaryPrompt = buildSummaryPrompt(analysis.messagesToCompress)

    const summaryContent = await callLLM(
      config,
      [
        {
          id: "summary-sys",
          role: "system",
          content: "",
          timestamp: Date.now(),
          visible: false,
        },
        {
          id: "summary-user",
          role: "user",
          content: summaryPrompt,
          timestamp: Date.now(),
          visible: false,
        },
      ],
      500
    )

    if (!summaryContent || summaryContent.trim().length === 0) {
      return {
        compressed: false,
        messages,
      }
    }

    const summaryMessage = createSummaryMessage(summaryContent, analysis.messagesToCompress)

    const compressedMessages = [
      ...analysis.preservedMessages,
      summaryMessage,
      ...analysis.recentMessages,
    ]

    return {
      compressed: true,
      messages: compressedMessages,
      summaryContent,
    }
  } catch (error) {
    console.warn("Context compression failed, using original messages:", error)
    return {
      compressed: false,
      messages,
    }
  }
}

export function estimateMessageTokens(messages: Message[]): number {
  let totalTokens = 0

  for (const msg of messages) {
    totalTokens += 4
    totalTokens += msg.content.length / 4
  }

  totalTokens += 2

  return Math.ceil(totalTokens)
}
