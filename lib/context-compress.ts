import { Message, ConversationRound } from "./types"
import { estimateTokens } from "./content-utils"

export const COMPRESS_PROMPT = `你是一个对话摘要器。请将以下苏格拉底式教学对话压缩为一段简洁的摘要。

要求:
- 保留用户已展示出的理解程度和知识盲区
- 保留关键讨论过的概念和结论
- 保留当前的讨论方向和苏格拉底的引导策略
- 保留用户选择的选项和对应回答（如有）
- 控制在 300-500 字以内
- 使用与原对话相同的语言
- 直接输出摘要文本，不要添加标题或前缀`

export const COMPRESS_TOKEN_THRESHOLD = 8000
export const COMPRESS_KEEP_ROUNDS = 4

export function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
}

export function shouldCompress(
  round: ConversationRound,
  threshold: number = COMPRESS_TOKEN_THRESHOLD
): boolean {
  const visibleMessages = round.messages.filter((m) => m.visible)
  if (visibleMessages.length < COMPRESS_KEEP_ROUNDS * 2 + 2) return false
  const tokens = estimateMessagesTokens(visibleMessages)
  return tokens > threshold
}

export function buildCompressedMessages(round: ConversationRound): Message[] {
  if (!round.compressedSummary || !round.compressedBeforeMessageId) {
    return round.messages
  }

  const result: Message[] = []
  let passedBoundary = false

  for (const msg of round.messages) {
    if (!msg.visible) {
      result.push(msg)
      continue
    }

    if (msg.id === round.compressedBeforeMessageId) {
      passedBoundary = true
    }

    if (!passedBoundary) continue

    result.push(msg)
  }

  const summaryInsertIndex = result.findIndex((m) => m.visible)
  const summaryMessage: Message = {
    id: "__compressed_summary__",
    role: "system",
    content: `[对话历史摘要]\n以下是对话早期内容的摘要：\n${round.compressedSummary}\n\n请基于此摘要和后续对话继续引导用户。`,
    timestamp: 0,
    visible: false,
  }

  if (summaryInsertIndex === -1) {
    result.push(summaryMessage)
  } else {
    result.splice(summaryInsertIndex, 0, summaryMessage)
  }

  return result
}

export function getCompressedBeforeMessageId(
  round: ConversationRound
): string | null {
  const visibleMessages = round.messages.filter((m) => m.visible)
  const keepCount = COMPRESS_KEEP_ROUNDS * 2
  if (visibleMessages.length <= keepCount) return null

  const boundaryIndex = visibleMessages.length - keepCount
  return visibleMessages[boundaryIndex].id
}

export function getCompressedRoundCount(round: ConversationRound): number {
  if (!round.compressedBeforeMessageId) return 0
  const visibleMessages = round.messages.filter((m) => m.visible)
  const boundaryIndex = visibleMessages.findIndex(
    (m) => m.id === round.compressedBeforeMessageId
  )
  if (boundaryIndex <= 0) return 0
  return Math.floor(boundaryIndex / 2)
}
