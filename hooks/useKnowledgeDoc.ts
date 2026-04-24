import { useState, useRef, useCallback } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import {
  OpenAIConfig,
  DEFAULT_OPENAI_CONFIG,
  UnderstandingStatus,
  KnowledgeDocument,
} from "../lib/types"
import {
  loadUnderstandingStatus,
  saveUnderstandingStatus,
  loadKnowledgeDocument,
  saveKnowledgeDocument,
} from "../lib/storage"
import { callLLM } from "../lib/llm"

const STATUS_UPDATE_PROMPT = `你是一个学习状态分析器。根据以下对话历史，评估用户对文档的理解状态。

请以 JSON 格式输出（不要包含 markdown 代码块标记）：
{
  "currentStage": "当前学习阶段，使用以下之一：初步接触 | 建立框架 | 深入理解 | 融会贯通",
  "mastered": ["已掌握的知识点1", "已掌握的知识点2"],
  "pendingClarification": ["待澄清的问题1", "待澄清的问题2"],
  "evidenceStatus": "对已掌握内容的信心程度：薄弱推断 | 部分验证 | 充分支持",
  "nextThinkingDirection": "建议用户下一步思考的方向"
}

要求：
- currentStage 必须从四个阶段中选择最匹配的
- mastered 列出用户已展现出理解的知识点
- pendingClarification 列出对话中暴露出的理解盲区
- evidenceStatus 基于用户回答的深度和准确性判断
- nextThinkingDirection 给出具体的、可操作的思考方向`

const SUMMARY_PROMPT = `你是一个知识文档生成器。请为以下文档内容生成一份精炼的摘要。

要求：
- 摘要应涵盖文档的核心主题、主要论点和关键结论
- 长度控制在 150-300 字
- 语言精炼，避免冗余
- 直接输出摘要文本，不要添加标题或前缀`

const CONCEPTS_CARDS_PROMPT = `你是一个知识文档生成器。请根据以下文档内容和对话历史，提取关键概念并生成知识卡片。

请以 JSON 格式输出（不要包含 markdown 代码块标记）：
{
  "keyConcepts": [
    { "name": "概念名称", "description": "概念简述（1-2句话）" }
  ],
  "knowledgeCards": [
    {
      "concept": "概念名称",
      "explanation": "一句话解释",
      "keyPoints": ["要点1", "要点2", "要点3"]
    }
  ]
}

要求：
- 提取 3-8 个关键概念
- 每个概念都需要对应一张知识卡片
- keyPoints 每张卡片 2-4 条
- 要点应包含：定义、核心特征、典型应用或常见误区
- 结合对话历史中用户已讨论过的内容，优先处理用户关注的概念`

const DOC_STATUS_PROMPT = `你是一个学习状态分析器。根据以下完整的对话历史，生成一份全面的理解状态评估。

请以 JSON 格式输出（不要包含 markdown 代码块标记）：
{
  "currentStage": "当前学习阶段：初步接触 | 建立框架 | 深入理解 | 融会贯通",
  "mastered": ["已掌握的知识点"],
  "pendingClarification": ["待澄清的问题"],
  "evidenceStatus": "证据状态描述（需比自动更新更详细，50-100字）",
  "nextThinkingDirection": "下一步思考方向（需比自动更新更具体，50-100字）"
}

要求：
- 这是知识文档的正式评估，需要比实时跟踪更全面深入
- mastered 应包含所有对话中展现出的理解
- pendingClarification 应包含所有未解决的疑问
- evidenceStatus 需要详细描述对用户理解的信心及依据
- nextThinkingDirection 需要给出具体的、可操作的学习建议`

const EXPORT_PROMPT = `你是一个知识文档编辑器。请将以下知识文档内容润色为一份结构清晰、语言流畅的 Markdown 文档。

要求：
- 使用恰当的 Markdown 格式（标题、列表、引用、粗体等）
- 语言流畅自然，像一篇精心编写的读书笔记
- 保持信息完整性的同时提升可读性
- 在文档末尾添加"学习状态"章节
- 不要添加原文中没有的信息，但可以优化表达方式
- 直接输出 Markdown 文本，不要包含代码块标记`

const parseLLMJson = (text: string): any => {
  let cleaned = text.trim()
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim()
  }
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    cleaned = jsonMatch[0]
  }
  return JSON.parse(cleaned)
}

const downloadMarkdown = (content: string, filename?: string) => {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${filename || "知识文档"}.md`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function useKnowledgeDoc(
  pageKeyRef: React.MutableRefObject<string>,
  pageTitle: string,
  pageUrl: string,
  buildConversationContext: () => string,
  getPageContent: () => Promise<string>,
  setErrorMessage: (msg: string | null) => void
) {
  const [config] = useStorage<OpenAIConfig>("openai-config", DEFAULT_OPENAI_CONFIG)

  const [showKnowledgePanel, setShowKnowledgePanel] = useState(false)
  const [knowledgeDoc, setKnowledgeDoc] = useState<KnowledgeDocument | null>(null)
  const [isGeneratingDoc, setIsGeneratingDoc] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [understandingStatus, setUnderstandingStatus] = useState<UnderstandingStatus | null>(null)
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false)
  const [showStatusDetail, setShowStatusDetail] = useState(false)
  const statusUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updateUnderstandingStatus = useCallback(async (
    rounds: any[],
    activeRoundId: string | null
  ) => {
    const currentKey = pageKeyRef.current
    if (!currentKey || !config.apiKey || !config.baseURL) return
    const round = rounds.find((r: any) => r.id === activeRoundId)
    if (!round || round.messages.filter((m: any) => m.visible && m.role === "user").length === 0) return

    setIsUpdatingStatus(true)
    try {
      const conversationContext = buildConversationContext()
      const pageContext = pageTitle ? `\n\n--- 文档信息 ---\n标题: ${pageTitle}\nURL: ${pageUrl}` : ""
      const result = await callLLM(config, [
        { id: "", role: "system", content: STATUS_UPDATE_PROMPT, timestamp: Date.now(), visible: true },
        { id: "", role: "user", content: pageContext + conversationContext, timestamp: Date.now(), visible: true },
      ])
      const parsed = parseLLMJson(result)
      const status: UnderstandingStatus = {
        currentStage: parsed.currentStage || "初步接触",
        mastered: Array.isArray(parsed.mastered) ? parsed.mastered : [],
        pendingClarification: Array.isArray(parsed.pendingClarification) ? parsed.pendingClarification : [],
        evidenceStatus: parsed.evidenceStatus || "薄弱推断",
        nextThinkingDirection: parsed.nextThinkingDirection || "",
        updatedAt: Date.now(),
      }
      await saveUnderstandingStatus(currentKey, status)
      setUnderstandingStatus(status)
    } catch {
    } finally {
      setIsUpdatingStatus(false)
    }
  }, [config, buildConversationContext, pageTitle, pageUrl])

  const scheduleStatusUpdate = useCallback((rounds: any[], activeRoundId: string | null) => {
    if (statusUpdateTimerRef.current) {
      clearTimeout(statusUpdateTimerRef.current)
    }
    statusUpdateTimerRef.current = setTimeout(() => {
      updateUnderstandingStatus(rounds, activeRoundId)
    }, 3000)
  }, [updateUnderstandingStatus])

  const generateKnowledgeDocument = useCallback(async () => {
    const currentKey = pageKeyRef.current
    if (!currentKey || !config.apiKey || !config.baseURL) return

    setIsGeneratingDoc(true)
    setShowKnowledgePanel(true)
    try {
      const content = await getPageContent()
      const conversationContext = buildConversationContext()
      const userContent = content + conversationContext

      const systemMessages = [
        { id: "", role: "system" as const, content: SUMMARY_PROMPT, timestamp: Date.now(), visible: true },
        { id: "", role: "user" as const, content: userContent, timestamp: Date.now(), visible: true },
      ]
      const conceptsMessages = [
        { id: "", role: "system" as const, content: CONCEPTS_CARDS_PROMPT, timestamp: Date.now(), visible: true },
        { id: "", role: "user" as const, content: userContent, timestamp: Date.now(), visible: true },
      ]
      const statusMessages = [
        { id: "", role: "system" as const, content: DOC_STATUS_PROMPT, timestamp: Date.now(), visible: true },
        { id: "", role: "user" as const, content: userContent, timestamp: Date.now(), visible: true },
      ]

      const [summaryResult, conceptsResult, statusResult] = await Promise.allSettled([
        callLLM(config, systemMessages, 2000),
        callLLM(config, conceptsMessages, 4000),
        callLLM(config, statusMessages, 2000),
      ])

      const summary = summaryResult.status === "fulfilled" ? summaryResult.value : "摘要生成失败，请尝试更新"

      let keyConcepts: { name: string; description: string }[] = []
      let knowledgeCards: { concept: string; explanation: string; keyPoints: string[] }[] = []
      if (conceptsResult.status === "fulfilled") {
        try {
          const parsed = parseLLMJson(conceptsResult.value)
          keyConcepts = Array.isArray(parsed.keyConcepts) ? parsed.keyConcepts : []
          knowledgeCards = Array.isArray(parsed.knowledgeCards) ? parsed.knowledgeCards : []
        } catch {}
      }

      let docStatus: UnderstandingStatus = {
        currentStage: "初步接触",
        mastered: [],
        pendingClarification: [],
        evidenceStatus: "薄弱推断",
        nextThinkingDirection: "",
        updatedAt: Date.now(),
      }
      if (statusResult.status === "fulfilled") {
        try {
          const parsed = parseLLMJson(statusResult.value)
          docStatus = {
            currentStage: parsed.currentStage || "初步接触",
            mastered: Array.isArray(parsed.mastered) ? parsed.mastered : [],
            pendingClarification: Array.isArray(parsed.pendingClarification) ? parsed.pendingClarification : [],
            evidenceStatus: parsed.evidenceStatus || "薄弱推断",
            nextThinkingDirection: parsed.nextThinkingDirection || "",
            updatedAt: Date.now(),
          }
        } catch {}
      }

      const existingDoc = await loadKnowledgeDocument(currentKey)
      const doc: KnowledgeDocument = {
        pageKey: currentKey,
        summary,
        keyConcepts,
        knowledgeCards,
        understandingStatus: docStatus,
        createdAt: existingDoc?.createdAt || Date.now(),
        updatedAt: Date.now(),
        pageTitle,
        pageUrl,
      }

      await saveKnowledgeDocument(currentKey, doc)
      setKnowledgeDoc(doc)
      await saveUnderstandingStatus(currentKey, docStatus)
      setUnderstandingStatus(docStatus)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "知识文档生成失败")
    } finally {
      setIsGeneratingDoc(false)
    }
  }, [config, pageTitle, pageUrl, buildConversationContext, getPageContent, setErrorMessage])

  const handleKnowledgeButtonClick = useCallback(async () => {
    if (showKnowledgePanel) {
      setShowKnowledgePanel(false)
      return
    }
    const currentKey = pageKeyRef.current
    if (!currentKey) return
    const existingDoc = await loadKnowledgeDocument(currentKey)
    if (existingDoc) {
      setKnowledgeDoc(existingDoc)
      setShowKnowledgePanel(true)
    } else {
      generateKnowledgeDocument()
    }
  }, [showKnowledgePanel, generateKnowledgeDocument])

  const handleExportMarkdown = useCallback(async () => {
    if (!knowledgeDoc) return
    setIsExporting(true)
    try {
      const rawParts: string[] = []
      rawParts.push(`# ${knowledgeDoc.pageTitle || "知识文档"}\n`)
      rawParts.push(`## 摘要\n${knowledgeDoc.summary}\n`)
      rawParts.push(`## 关键概念\n`)
      for (const c of knowledgeDoc.keyConcepts) {
        rawParts.push(`- **${c.name}**: ${c.description}`)
      }
      rawParts.push(`\n## 知识卡片\n`)
      for (const card of knowledgeDoc.knowledgeCards) {
        rawParts.push(`### ${card.concept}\n${card.explanation}\n`)
        for (const p of card.keyPoints) {
          rawParts.push(`- ${p}`)
        }
        rawParts.push("")
      }
      rawParts.push(`## 学习状态\n`)
      rawParts.push(`- 当前阶段: ${knowledgeDoc.understandingStatus.currentStage}`)
      rawParts.push(`- 已掌握: ${knowledgeDoc.understandingStatus.mastered.join("、")}`)
      rawParts.push(`- 待澄清: ${knowledgeDoc.understandingStatus.pendingClarification.join("、")}`)
      rawParts.push(`- 证据状态: ${knowledgeDoc.understandingStatus.evidenceStatus}`)
      rawParts.push(`- 下一步思考: ${knowledgeDoc.understandingStatus.nextThinkingDirection}`)

      const rawMarkdown = rawParts.join("\n")

      try {
        const polished = await callLLM(config, [
          { id: "", role: "system", content: EXPORT_PROMPT, timestamp: Date.now(), visible: true },
          { id: "", role: "user", content: rawMarkdown, timestamp: Date.now(), visible: true },
        ], 4000)
        downloadMarkdown(polished, knowledgeDoc.pageTitle)
      } catch {
        downloadMarkdown(rawMarkdown, knowledgeDoc.pageTitle)
      }
    } catch {
    } finally {
      setIsExporting(false)
    }
  }, [knowledgeDoc, config])

  const loadStatusForPage = useCallback(async (pageKey: string) => {
    const loadedStatus = await loadUnderstandingStatus(pageKey)
    setUnderstandingStatus(loadedStatus)
  }, [])

  const resetForPage = useCallback(() => {
    setShowKnowledgePanel(false)
    setKnowledgeDoc(null)
    setShowStatusDetail(false)
    setUnderstandingStatus(null)
  }, [])

  return {
    showKnowledgePanel,
    setShowKnowledgePanel,
    knowledgeDoc,
    setKnowledgeDoc,
    isGeneratingDoc,
    isExporting,
    understandingStatus,
    setUnderstandingStatus,
    isUpdatingStatus,
    showStatusDetail,
    setShowStatusDetail,
    scheduleStatusUpdate,
    generateKnowledgeDocument,
    handleKnowledgeButtonClick,
    handleExportMarkdown,
    loadStatusForPage,
    resetForPage,
  }
}
