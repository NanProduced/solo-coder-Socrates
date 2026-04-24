import { useState, useEffect, useMemo, useCallback } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import {
  KnowledgeDocument,
  OpenAIConfig,
  DEFAULT_OPENAI_CONFIG,
  CrossDocumentAnalysis,
  DocumentRelation,
  ConceptRelation,
  LearningPathStep,
} from "../lib/types"
import { loadAllKnowledgeDocuments, loadKnowledgeDocument, loadPageConversations } from "../lib/storage"
import { callLLM, LLMError } from "../lib/llm"

const CROSS_DOC_ANALYSIS_PROMPT = `你是一个知识图谱分析师。请分析以下多个知识文档，发现它们之间的关联关系，并给出学习建议。

## 输入格式说明
以下是多个知识文档的元数据，每个文档包含：
- 标题、URL、学习阶段
- 摘要（150-300字）
- 关键概念列表（概念名 + 简短描述）
- 知识卡片概念列表（仅概念名）

## 输出要求
请以严格的 JSON 格式输出分析结果（不要包含 markdown 代码块标记）：

{
  "documentRelations": [
    {
      "sourcePageKey": "文档A的pageKey",
      "targetPageKey": "文档B的pageKey",
      "relationType": "prerequisite",
      "description": "文档A是文档B的前置知识，因为...",
      "strength": 0.9
    }
  ],
  "conceptRelations": [
    {
      "concept": "概念名",
      "relationType": "common",
      "appearingDocuments": ["pageKey1", "pageKey2"],
      "description": "这个概念在多个文档中出现，是核心知识点"
    }
  ],
  "recommendedLearningPath": [
    {
      "pageKey": "文档pageKey",
      "reason": "这是入门文档，应该先学习",
      "estimatedDifficulty": "beginner",
      "prerequisites": []
    }
  ],
  "overallRecommendation": "整体学习建议...",
  "keyInsights": ["洞察1", "洞察2", "洞察3"]
}

## 字段说明

### documentRelations（文档关联关系）
- relationType 可选值：
  - "prerequisite": 前置依赖（source 需要在 target 之前学习）
  - "complementary": 互补关系（两文档内容互补，可并行学习）
  - "extension": 扩展关系（source 是基础，target 是深入扩展）
  - "alternative": 替代关系（两文档内容相似，可选其一）
- strength: 0.0-1.0 的强度值，表示关联的紧密程度

### conceptRelations（概念关系）
- relationType 可选值：
  - "common": 共同概念（出现在多个文档中）
  - "complementary": 互补概念（不同文档的概念可互相补充）
  - "dependent": 依赖概念（概念之间有前置依赖关系）
  - "conflicting": 冲突概念（不同文档对同一概念有不同解释）

### recommendedLearningPath（推荐学习路径）
- estimatedDifficulty 可选值："beginner" | "intermediate" | "advanced"
- prerequisites: 学习此文档前需要掌握的其他文档的 pageKey 列表

### keyInsights
- 3-5 条关键洞察，帮助用户理解整个知识库的结构和价值

## 分析原则
1. 基于文档的学习阶段判断难度和顺序
2. "初步接触"阶段的文档通常是入门文档
3. "融会贯通"阶段的文档通常是高级文档
4. 概念重叠越多的文档，关联强度越高
5. 摘要内容相似性也是判断关联的重要依据

请仔细分析输入，输出结构完整、逻辑清晰的分析结果。`

const MAX_DOCUMENTS_FOR_ANALYSIS = 10
const MAX_SUMMARY_LENGTH = 150
const MAX_CONCEPTS_PER_DOC = 8

interface TruncatedDocument {
  pageKey: string
  pageTitle: string
  pageUrl: string
  currentStage: string
  summary: string
  keyConcepts: { name: string; description: string }[]
  cardConcepts: string[]
}

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

const truncateDocumentForAnalysis = (doc: KnowledgeDocument): TruncatedDocument => {
  const truncatedSummary = doc.summary.length > MAX_SUMMARY_LENGTH
    ? doc.summary.slice(0, MAX_SUMMARY_LENGTH) + "..."
    : doc.summary

  const truncatedKeyConcepts = doc.keyConcepts
    .slice(0, MAX_CONCEPTS_PER_DOC)
    .map((c) => ({
      name: c.name,
      description: c.description.length > 50 ? c.description.slice(0, 50) + "..." : c.description,
    }))

  const cardConcepts = doc.knowledgeCards
    .slice(0, MAX_CONCEPTS_PER_DOC)
    .map((c) => c.concept)

  return {
    pageKey: doc.pageKey,
    pageTitle: doc.pageTitle,
    pageUrl: doc.pageUrl,
    currentStage: doc.understandingStatus.currentStage,
    summary: truncatedSummary,
    keyConcepts: truncatedKeyConcepts,
    cardConcepts,
  }
}

const buildAnalysisInput = (docs: KnowledgeDocument[]): { input: string; truncated: boolean; count: number } => {
  const needsTruncation = docs.length > MAX_DOCUMENTS_FOR_ANALYSIS
  const docsToProcess = needsTruncation
    ? docs.slice(0, MAX_DOCUMENTS_FOR_ANALYSIS)
    : docs

  const parts: string[] = []

  docsToProcess.forEach((doc, index) => {
    const truncated = truncateDocumentForAnalysis(doc)
    parts.push(`\n## 文档 ${index + 1}`)
    parts.push(`- pageKey: ${doc.pageKey}`)
    parts.push(`- 标题: ${doc.pageTitle || "未命名"}`)
    parts.push(`- URL: ${doc.pageUrl || "未知"}`)
    parts.push(`- 学习阶段: ${doc.understandingStatus.currentStage}`)
    parts.push(`- 摘要: ${truncated.summary}`)

    if (truncated.keyConcepts.length > 0) {
      parts.push(`- 关键概念:`)
      truncated.keyConcepts.forEach((c) => {
        parts.push(`  - ${c.name}: ${c.description}`)
      })
    }

    if (truncated.cardConcepts.length > 0) {
      parts.push(`- 知识卡片概念: ${truncated.cardConcepts.join("、")}`)
    }
  })

  if (needsTruncation) {
    parts.push(`\n[注意]: 共 ${docs.length} 篇文档，仅分析了前 ${MAX_DOCUMENTS_FOR_ANALYSIS} 篇`)
  }

  return {
    input: parts.join("\n"),
    truncated: needsTruncation,
    count: docsToProcess.length,
  }
}

const VALID_RELATION_TYPES = new Set(["prerequisite", "complementary", "extension", "alternative"])
const VALID_CONCEPT_RELATION_TYPES = new Set(["common", "complementary", "dependent", "conflicting"])
const VALID_DIFFICULTIES = new Set(["beginner", "intermediate", "advanced"])

const isValidString = (value: unknown): value is string => {
  return typeof value === "string" && value.trim().length > 0
}

const isValidNumber = (value: unknown): value is number => {
  return typeof value === "number" && !Number.isNaN(value)
}

const isValidArray = (value: unknown): value is unknown[] => {
  return Array.isArray(value)
}

const validateDocumentRelation = (item: unknown, validPageKeys: Set<string>): DocumentRelation | null => {
  if (!item || typeof item !== "object") return null

  const obj = item as Record<string, unknown>

  const sourcePageKey = isValidString(obj.sourcePageKey) ? obj.sourcePageKey : ""
  const targetPageKey = isValidString(obj.targetPageKey) ? obj.targetPageKey : ""

  if (!sourcePageKey || !targetPageKey) return null
  if (sourcePageKey === targetPageKey) return null

  let relationType: "prerequisite" | "complementary" | "extension" | "alternative" = "complementary"
  if (isValidString(obj.relationType) && VALID_RELATION_TYPES.has(obj.relationType)) {
    relationType = obj.relationType as typeof relationType
  }

  const description = isValidString(obj.description) ? obj.description : ""
  const strength = isValidNumber(obj.strength) ? Math.max(0, Math.min(1, obj.strength)) : 0.5

  if (!validPageKeys.has(sourcePageKey) || !validPageKeys.has(targetPageKey)) {
    return null
  }

  return {
    sourcePageKey,
    targetPageKey,
    relationType,
    description,
    strength,
  }
}

const validateConceptRelation = (item: unknown, validPageKeys: Set<string>): ConceptRelation | null => {
  if (!item || typeof item !== "object") return null

  const obj = item as Record<string, unknown>

  const concept = isValidString(obj.concept) ? obj.concept.trim() : ""
  if (!concept) return null

  let relationType: "common" | "complementary" | "dependent" | "conflicting" = "common"
  if (isValidString(obj.relationType) && VALID_CONCEPT_RELATION_TYPES.has(obj.relationType)) {
    relationType = obj.relationType as typeof relationType
  }

  const description = isValidString(obj.description) ? obj.description : ""

  let appearingDocuments: string[] = []
  if (isValidArray(obj.appearingDocuments)) {
    appearingDocuments = obj.appearingDocuments
      .filter(isValidString)
      .filter((pk) => validPageKeys.has(pk))
  }

  if (appearingDocuments.length < 2) return null

  return {
    concept,
    relationType,
    appearingDocuments,
    description,
  }
}

const validateLearningPathStep = (item: unknown, validPageKeys: Set<string>): LearningPathStep | null => {
  if (!item || typeof item !== "object") return null

  const obj = item as Record<string, unknown>

  const pageKey = isValidString(obj.pageKey) ? obj.pageKey : ""
  if (!pageKey || !validPageKeys.has(pageKey)) return null

  const reason = isValidString(obj.reason) ? obj.reason : ""

  let estimatedDifficulty: "beginner" | "intermediate" | "advanced" = "intermediate"
  if (isValidString(obj.estimatedDifficulty) && VALID_DIFFICULTIES.has(obj.estimatedDifficulty)) {
    estimatedDifficulty = obj.estimatedDifficulty as typeof estimatedDifficulty
  }

  let prerequisites: string[] = []
  if (isValidArray(obj.prerequisites)) {
    prerequisites = obj.prerequisites
      .filter(isValidString)
      .filter((pk) => validPageKeys.has(pk) && pk !== pageKey)
  }

  return {
    pageKey,
    reason,
    estimatedDifficulty,
    prerequisites,
  }
}

interface ValidateAnalysisResult {
  documentRelations: DocumentRelation[]
  conceptRelations: ConceptRelation[]
  recommendedLearningPath: LearningPathStep[]
  overallRecommendation: string
  keyInsights: string[]
}

const validateAnalysisResult = (
  parsed: unknown,
  validPageKeys: Set<string>
): ValidateAnalysisResult => {
  const defaultResult: ValidateAnalysisResult = {
    documentRelations: [],
    conceptRelations: [],
    recommendedLearningPath: [],
    overallRecommendation: "暂无整体建议",
    keyInsights: [],
  }

  if (!parsed || typeof parsed !== "object") {
    return defaultResult
  }

  const obj = parsed as Record<string, unknown>

  let documentRelations: DocumentRelation[] = []
  if (isValidArray(obj.documentRelations)) {
    documentRelations = obj.documentRelations
      .map((item) => validateDocumentRelation(item, validPageKeys))
      .filter((item): item is DocumentRelation => item !== null)
  }

  let conceptRelations: ConceptRelation[] = []
  if (isValidArray(obj.conceptRelations)) {
    conceptRelations = obj.conceptRelations
      .map((item) => validateConceptRelation(item, validPageKeys))
      .filter((item): item is ConceptRelation => item !== null)
  }

  let recommendedLearningPath: LearningPathStep[] = []
  if (isValidArray(obj.recommendedLearningPath)) {
    const seenPageKeys = new Set<string>()
    recommendedLearningPath = obj.recommendedLearningPath
      .map((item) => validateLearningPathStep(item, validPageKeys))
      .filter((item): item is LearningPathStep => item !== null)
      .filter((item) => {
        if (seenPageKeys.has(item.pageKey)) return false
        seenPageKeys.add(item.pageKey)
        return true
      })
  }

  const overallRecommendation = isValidString(obj.overallRecommendation)
    ? obj.overallRecommendation
    : defaultResult.overallRecommendation

  let keyInsights: string[] = []
  if (isValidArray(obj.keyInsights)) {
    keyInsights = obj.keyInsights.filter(isValidString)
  }

  return {
    documentRelations,
    conceptRelations,
    recommendedLearningPath,
    overallRecommendation,
    keyInsights,
  }
}

const areFilterConditionsEqual = (
  a: { searchQuery: string; selectedStage: string; documentPageKeys: string[] } | null,
  b: { searchQuery: string; selectedStage: string; documentPageKeys: string[] }
): boolean => {
  if (!a) return false
  if (a.searchQuery !== b.searchQuery) return false
  if (a.selectedStage !== b.selectedStage) return false
  if (a.documentPageKeys.length !== b.documentPageKeys.length) return false
  const sortedA = [...a.documentPageKeys].sort()
  const sortedB = [...b.documentPageKeys].sort()
  return sortedA.every((key, idx) => key === sortedB[idx])
}

const LEARNING_STAGES = ["初步接触", "建立框架", "深入理解", "融会贯通"] as const
type LearningStage = (typeof LEARNING_STAGES)[number]

interface ConceptAssociation {
  concept: string
  documents: { pageKey: string; pageTitle: string }[]
  description?: string
}

interface KnowledgeLibraryProps {
  onBack: () => void
  onViewDocument: (doc: KnowledgeDocument) => void
  onViewAllKnowledge: () => void
}

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)

  if (date >= today) {
    return `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
  }
  if (date >= yesterday) {
    return `昨天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
  }
  return (
    date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) +
    " " +
    date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  )
}

const extractHostname = (url: string): string => {
  try {
    const urlObj = new URL(url)
    if (urlObj.protocol === "file:") {
      const filename = urlObj.pathname.split("/").pop() || ""
      return filename ? decodeURIComponent(filename) : "本地文件"
    }
    return urlObj.hostname
  } catch {
    return url
  }
}

const getStageColor = (stage: string) => {
  switch (stage) {
    case "初步接触":
      return "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
    case "建立框架":
      return "bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400"
    case "深入理解":
      return "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
    case "融会贯通":
      return "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
    default:
      return "bg-gray-50 text-gray-700 dark:bg-gray-900/20 dark:text-gray-400"
  }
}

const getStageIcon = (stage: string) => {
  switch (stage) {
    case "初步接触":
      return "🌱"
    case "建立框架":
      return "🏗️"
    case "深入理解":
      return "🔍"
    case "融会贯通":
      return "💡"
    default:
      return "📄"
  }
}

export const KnowledgeLibrary = ({
  onBack,
  onViewDocument,
  onViewAllKnowledge,
}: KnowledgeLibraryProps) => {
  const [config] = useStorage<OpenAIConfig>("openai-config", DEFAULT_OPENAI_CONFIG)
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedStage, setSelectedStage] = useState<LearningStage | "全部">("全部")
  const [showConceptsPanel, setShowConceptsPanel] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [expandedConceptKey, setExpandedConceptKey] = useState<string | null>(null)

  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<CrossDocumentAnalysis | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [truncatedCount, setTruncatedCount] = useState(0)
  const [showAnalysisPanel, setShowAnalysisPanel] = useState(false)
  const [analysisFilterConditions, setAnalysisFilterConditions] = useState<{
    searchQuery: string
    selectedStage: string
    documentPageKeys: string[]
    documentCount: number
  } | null>(null)

  const getDocTitleByPageKey = useCallback(
    (pageKey: string): string => {
      const doc = documents.find((d) => d.pageKey === pageKey)
      return doc?.pageTitle || "未命名文档"
    },
    [documents]
  )

  const getRelationTypeLabel = (type: string): string => {
    switch (type) {
      case "prerequisite":
        return "前置依赖"
      case "complementary":
        return "互补关系"
      case "extension":
        return "扩展关系"
      case "alternative":
        return "替代关系"
      default:
        return type
    }
  }

  const getConceptRelationTypeLabel = (type: string): string => {
    switch (type) {
      case "common":
        return "共同概念"
      case "complementary":
        return "互补概念"
      case "dependent":
        return "依赖概念"
      case "conflicting":
        return "冲突概念"
      default:
        return type
    }
  }

  const getDifficultyLabel = (difficulty: string): string => {
    switch (difficulty) {
      case "beginner":
        return "入门"
      case "intermediate":
        return "中级"
      case "advanced":
        return "高级"
      default:
        return difficulty
    }
  }

  const getDifficultyColor = (difficulty: string): string => {
    switch (difficulty) {
      case "beginner":
        return "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
      case "intermediate":
        return "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
      case "advanced":
        return "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
      default:
        return "bg-gray-50 text-gray-700 dark:bg-gray-900/20 dark:text-gray-400"
    }
  }

  const loadDocuments = useCallback(async () => {
    setIsLoading(true)
    try {
      const allDocs = await loadAllKnowledgeDocuments()
      setDocuments(allDocs)
    } catch (error) {
      console.error("Failed to load knowledge documents:", error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDocuments()
  }, [loadDocuments])

  const normalizeConcept = (name: string): string => {
    return name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
  }

  const commonConcepts = useMemo<ConceptAssociation[]>(() => {
    const conceptMap = new Map<string, ConceptAssociation>()

    documents.forEach((doc) => {
      doc.keyConcepts.forEach((concept) => {
        const normalizedKey = normalizeConcept(concept.name)
        const existing = conceptMap.get(normalizedKey)
        if (existing) {
          const exists = existing.documents.some((d) => d.pageKey === doc.pageKey)
          if (!exists) {
            existing.documents.push({
              pageKey: doc.pageKey,
              pageTitle: doc.pageTitle,
            })
          }
          if (!existing.description) {
            existing.description = concept.description
          }
        } else {
          conceptMap.set(normalizedKey, {
            concept: concept.name,
            documents: [{ pageKey: doc.pageKey, pageTitle: doc.pageTitle }],
            description: concept.description,
          })
        }
      })

      doc.knowledgeCards.forEach((card) => {
        const normalizedKey = normalizeConcept(card.concept)
        const existing = conceptMap.get(normalizedKey)
        if (existing) {
          const exists = existing.documents.some((d) => d.pageKey === doc.pageKey)
          if (!exists) {
            existing.documents.push({
              pageKey: doc.pageKey,
              pageTitle: doc.pageTitle,
            })
          }
        } else {
          conceptMap.set(normalizedKey, {
            concept: card.concept,
            documents: [{ pageKey: doc.pageKey, pageTitle: doc.pageTitle }],
            description: card.explanation,
          })
        }
      })
    })

    return Array.from(conceptMap.values())
      .filter((c) => c.documents.length >= 2)
      .sort((a, b) => b.documents.length - a.documents.length)
  }, [documents])

  const getRelatedDocTitles = useCallback(
    (docPageKey: string, docCommonConcepts: ConceptAssociation[]): string[] => {
      const relatedDocSet = new Set<string>()
      const relatedPageKeys = new Set<string>()

      docCommonConcepts.forEach((concept) => {
        concept.documents.forEach((relatedDoc) => {
          if (relatedDoc.pageKey !== docPageKey && !relatedPageKeys.has(relatedDoc.pageKey)) {
            relatedPageKeys.add(relatedDoc.pageKey)
            const title = relatedDoc.pageTitle || "未命名文档"
            relatedDocSet.add(title)
          }
        })
      })

      return Array.from(relatedDocSet).slice(0, 2)
    },
    []
  )

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      if (selectedStage !== "全部" && doc.understandingStatus.currentStage !== selectedStage) {
        return false
      }

      if (!searchQuery.trim()) {
        return true
      }

      const query = searchQuery.toLowerCase().trim()

      if (doc.pageTitle?.toLowerCase().includes(query)) {
        return true
      }
      if (doc.summary?.toLowerCase().includes(query)) {
        return true
      }

      for (const concept of doc.keyConcepts) {
        if (
          concept.name.toLowerCase().includes(query) ||
          concept.description.toLowerCase().includes(query)
        ) {
          return true
        }
      }

      for (const card of doc.knowledgeCards) {
        if (
          card.concept.toLowerCase().includes(query) ||
          card.explanation.toLowerCase().includes(query) ||
          card.keyPoints.some((p) => p.toLowerCase().includes(query))
        ) {
          return true
        }
      }

      return false
    })
  }, [documents, searchQuery, selectedStage])

  const currentFilterConditions = useMemo(() => ({
    searchQuery,
    selectedStage,
    documentPageKeys: filteredDocuments.map((d) => d.pageKey),
    documentCount: filteredDocuments.length,
  }), [searchQuery, selectedStage, filteredDocuments])

  const isAnalysisResultStale = useMemo(() => {
    if (!analysisResult) return false
    return !areFilterConditionsEqual(analysisFilterConditions, currentFilterConditions)
  }, [analysisResult, analysisFilterConditions, currentFilterConditions])

  const analyzeCrossDocument = useCallback(async () => {
    if (!config.apiKey || !config.baseURL) {
      setAnalysisError("请先在设置中配置 API 参数")
      return
    }

    if (filteredDocuments.length === 0) {
      setAnalysisError("没有可分析的文档")
      return
    }

    const validPageKeys = new Set(filteredDocuments.map((d) => d.pageKey))

    setIsAnalyzing(true)
    setAnalysisError(null)
    setShowAnalysisPanel(true)
    setAnalysisFilterConditions({
      searchQuery,
      selectedStage,
      documentPageKeys: filteredDocuments.map((d) => d.pageKey),
      documentCount: filteredDocuments.length,
    })

    try {
      const { input, truncated, count } = buildAnalysisInput(filteredDocuments)
      setTruncatedCount(truncated ? filteredDocuments.length - count : 0)

      const result = await callLLM(
        config,
        [
          {
            id: "",
            role: "system",
            content: CROSS_DOC_ANALYSIS_PROMPT,
            timestamp: Date.now(),
            visible: true,
          },
          {
            id: "",
            role: "user",
            content: `请分析以下 ${count} 篇知识文档：\n${input}`,
            timestamp: Date.now(),
            visible: true,
          },
        ],
        6000
      )

      let parsed: unknown
      try {
        parsed = parseLLMJson(result)
      } catch {
        setAnalysisError("解析结果失败，返回格式不正确")
        return
      }

      const validated = validateAnalysisResult(parsed, validPageKeys)

      const analysis: CrossDocumentAnalysis = {
        documentRelations: validated.documentRelations,
        conceptRelations: validated.conceptRelations,
        recommendedLearningPath: validated.recommendedLearningPath,
        overallRecommendation: validated.overallRecommendation,
        keyInsights: validated.keyInsights,
      }

      setAnalysisResult(analysis)
    } catch (error) {
      if (error instanceof LLMError) {
        setAnalysisError(`分析失败: ${error.message}`)
      } else {
        setAnalysisError("分析过程中发生未知错误")
      }
    } finally {
      setIsAnalyzing(false)
    }
  }, [config, filteredDocuments, searchQuery, selectedStage])

  const handleExportAll = useCallback(async () => {
    if (documents.length === 0) return

    setIsExporting(true)
    try {
      const parts: string[] = []

      parts.push(`# 知识库总览\n`)
      parts.push(`> 共 ${documents.length} 篇文档，生成于 ${new Date().toLocaleString("zh-CN")}\n`)
      parts.push(`\n---\n`)

      documents.forEach((doc, index) => {
        parts.push(`\n# 第 ${index + 1} 篇：${doc.pageTitle || "未命名文档"}\n`)
        parts.push(`\n## 基本信息\n`)
        parts.push(`- **来源**：${doc.pageUrl ? extractHostname(doc.pageUrl) : "未知"}`)
        if (doc.pageUrl) {
          parts.push(`- **链接**：${doc.pageUrl}`)
        }
        parts.push(`- **当前阶段**：${doc.understandingStatus.currentStage}`)
        parts.push(`- **更新时间**：${formatTime(doc.updatedAt)}`)
        parts.push(`- **概念数**：${doc.keyConcepts.length}`)
        parts.push(`- **知识卡片数**：${doc.knowledgeCards.length}`)

        parts.push(`\n## 摘要\n${doc.summary}\n`)

        if (doc.keyConcepts.length > 0) {
          parts.push(`\n## 关键概念\n`)
          for (const c of doc.keyConcepts) {
            parts.push(`- **${c.name}**：${c.description}`)
          }
        }

        if (doc.knowledgeCards.length > 0) {
          parts.push(`\n## 知识卡片\n`)
          for (const card of doc.knowledgeCards) {
            parts.push(`\n### ${card.concept}\n`)
            parts.push(`${card.explanation}\n`)
            for (const p of card.keyPoints) {
              parts.push(`- ${p}`)
            }
          }
        }

        parts.push(`\n## 学习状态\n`)
        parts.push(`- **当前阶段**：${doc.understandingStatus.currentStage}`)
        if (doc.understandingStatus.mastered.length > 0) {
          parts.push(`- **已掌握**：${doc.understandingStatus.mastered.join("、")}`)
        }
        if (doc.understandingStatus.pendingClarification.length > 0) {
          parts.push(`- **待澄清**：${doc.understandingStatus.pendingClarification.join("、")}`)
        }
        parts.push(`- **理解信心**：${doc.understandingStatus.evidenceStatus}`)
        if (doc.understandingStatus.nextThinkingDirection) {
          parts.push(`- **下一步思考**：${doc.understandingStatus.nextThinkingDirection}`)
        }

        parts.push(`\n---\n`)
      })

      if (commonConcepts.length > 0) {
        parts.push(`\n# 跨文档概念关联\n`)
        parts.push(`\n以下概念出现在多个文档中，可能存在知识关联：\n`)

        commonConcepts.forEach((c) => {
          parts.push(`\n## ${c.concept}`)
          if (c.description) {
            parts.push(`\n${c.description}\n`)
          }
          parts.push(`\n**出现于 ${c.documents.length} 篇文档**：`)
          c.documents.forEach((d, i) => {
            parts.push(`${i + 1}. ${d.pageTitle || "未命名文档"}`)
          })
        })
      }

      const content = parts.join("\n")
      const blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `知识库总览_${new Date().toISOString().slice(0, 10)}.md`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("Export failed:", error)
    } finally {
      setIsExporting(false)
    }
  }, [documents, commonConcepts])

  const handleViewDocumentByPageKey = useCallback(
    async (pageKey: string) => {
      const doc = await loadKnowledgeDocument(pageKey)
      if (doc) {
        onViewDocument(doc)
      }
    },
    [onViewDocument]
  )

  const toggleConceptExpand = (conceptKey: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedConceptKey(expandedConceptKey === conceptKey ? null : conceptKey)
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="sticky top-0 z-10 bg-notion-bg border-b border-notion-border">
          <div className="px-4 py-3 flex items-center gap-2">
            <button
              onClick={onBack}
              className="text-notion-text-secondary hover:text-notion-text transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-sm font-bold">知识库</h2>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 mx-auto mb-4 border-2 border-notion-accent/30 border-t-notion-accent rounded-full animate-spin" />
            <p className="text-sm text-notion-text-secondary">加载中...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-notion-bg border-b border-notion-border">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <button
                onClick={onBack}
                className="text-notion-text-secondary hover:text-notion-text transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h2 className="text-sm font-bold">知识库</h2>
              <span className="text-[10px] px-2 py-0.5 bg-notion-accent/10 text-notion-accent rounded-full">
                {documents.length} 篇
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowConceptsPanel(!showConceptsPanel)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors ${
                  showConceptsPanel
                    ? "text-notion-accent bg-notion-accent/10"
                    : "text-notion-text-secondary hover:bg-notion-hover"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
                  />
                </svg>
                <span>共同概念</span>
                {commonConcepts.length > 0 && (
                  <span className="text-[9px] px-1 bg-notion-accent text-white rounded-full">
                    {commonConcepts.length}
                  </span>
                )}
              </button>
              {documents.length > 0 && (
                <>
                  <span className="text-notion-border">|</span>
                  <button
                    onClick={() => {
                      setShowAnalysisPanel(!showAnalysisPanel)
                      if (!showAnalysisPanel && !analysisResult && !isAnalyzing) {
                        setAnalysisError(null)
                      }
                    }}
                    disabled={isAnalyzing}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors ${
                      showAnalysisPanel
                        ? "text-notion-accent bg-notion-accent/10"
                        : "text-notion-text-secondary hover:bg-notion-hover"
                    } disabled:opacity-50`}
                  >
                    {isAnalyzing ? (
                      <div className="w-3.5 h-3.5 border-2 border-notion-accent/30 border-t-notion-accent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                        />
                      </svg>
                    )}
                    <span>{isAnalyzing ? "分析中..." : "AI分析"}</span>
                    {analysisResult && (
                      <span className="text-[9px] px-1 bg-green-500 text-white rounded-full">✓</span>
                    )}
                  </button>
                  <span className="text-notion-border">|</span>
                  <button
                    onClick={handleExportAll}
                    disabled={isExporting}
                    className="text-[11px] text-notion-accent hover:text-notion-accent-hover font-medium transition-colors disabled:opacity-50"
                  >
                    {isExporting ? "导出中..." : "导出全部"}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-notion-text-secondary/60"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索标题、摘要、概念、卡片内容..."
                className="w-full pl-9 pr-3 py-2 bg-notion-bg-secondary border border-notion-border rounded-lg text-sm focus:outline-none focus:border-notion-accent/50 placeholder:text-notion-text-secondary/40"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-notion-text-secondary/60 hover:text-notion-text"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
              <button
                onClick={() => setSelectedStage("全部")}
                className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  selectedStage === "全部"
                    ? "bg-notion-text text-notion-bg"
                    : "bg-notion-bg-secondary text-notion-text-secondary hover:bg-notion-hover"
                }`}
              >
                全部
              </button>
              {LEARNING_STAGES.map((stage) => (
                <button
                  key={stage}
                  onClick={() => setSelectedStage(stage)}
                  className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    selectedStage === stage
                      ? "bg-notion-text text-notion-bg"
                      : "bg-notion-bg-secondary text-notion-text-secondary hover:bg-notion-hover"
                  }`}
                >
                  {getStageIcon(stage)} {stage}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showConceptsPanel && commonConcepts.length > 0 && (
        <div className="bg-notion-bg-secondary/50 border-b border-notion-border">
          <div className="px-4 py-3">
            <h3 className="text-xs font-semibold text-notion-text-secondary uppercase tracking-wider mb-2">
              跨文档共同概念 ({commonConcepts.length})
            </h3>
            <div className="flex flex-col gap-1.5">
              {commonConcepts.slice(0, 20).map((c) => {
                const normalizedKey = normalizeConcept(c.concept)
                const isExpanded = expandedConceptKey === normalizedKey
                return (
                  <div key={normalizedKey} className="flex flex-col">
                    <div
                      className="flex items-center justify-between px-2 py-1.5 bg-notion-accent/10 text-notion-accent rounded-lg text-xs cursor-pointer hover:bg-notion-accent/20 transition-colors group"
                      onClick={(e) => toggleConceptExpand(normalizedKey, e)}
                      title={`${c.description || ""}\n出现在 ${c.documents.length} 篇文档中`}
                    >
                      <div className="flex items-center gap-1.5">
                        <svg
                          className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <span className="font-medium">{c.concept}</span>
                        <span className="text-[9px] opacity-60">×{c.documents.length}</span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-1.5 ml-4 pl-3 border-l-2 border-notion-accent/30">
                        <p className="text-[10px] text-notion-text-secondary font-medium mb-1.5">关联文档：</p>
                        <div className="flex flex-col gap-1">
                          {c.documents.map((doc, idx) => {
                            const truncatedTitle = doc.pageTitle?.length > 40
                              ? doc.pageTitle.slice(0, 40) + "..."
                              : doc.pageTitle || "未命名文档"
                            return (
                              <div
                                key={`${doc.pageKey}-${idx}`}
                                className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-notion-text-secondary hover:bg-notion-bg-secondary cursor-pointer transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleViewDocumentByPageKey(doc.pageKey)
                                }}
                              >
                                <svg className="w-3 h-3 text-notion-text-secondary/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                                </svg>
                                <span className="truncate">{truncatedTitle}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
              {commonConcepts.length > 20 && (
                <p className="text-xs text-notion-text-secondary opacity-60 text-center py-1">
                  +{commonConcepts.length - 20} 更多共同概念
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {showAnalysisPanel && (
        <div className="bg-notion-bg-secondary/50 border-b border-notion-border">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-notion-text-secondary uppercase tracking-wider">
                跨文档 AI 分析
              </h3>
              {!isAnalyzing && (
                <button
                  onClick={analyzeCrossDocument}
                  disabled={filteredDocuments.length === 0 || !config.apiKey || !config.baseURL}
                  className="text-[10px] px-2 py-1 bg-notion-accent text-white rounded hover:bg-notion-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {analysisResult ? "重新分析" : "开始分析"}
                </button>
              )}
            </div>

            {truncatedCount > 0 && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 mb-2">
                ⚠️ 文档数量较多，仅分析了前 {MAX_DOCUMENTS_FOR_ANALYSIS} 篇（共 {filteredDocuments.length} 篇）
              </p>
            )}

            {isAnalyzing && (
              <div className="flex flex-col items-center justify-center py-8">
                <div className="w-10 h-10 mb-4 border-2 border-notion-accent/30 border-t-notion-accent rounded-full animate-spin" />
                <p className="text-sm text-notion-text-secondary">正在分析文档关联关系...</p>
                <p className="text-xs text-notion-text-secondary/60 mt-1">
                  基于 {Math.min(filteredDocuments.length, MAX_DOCUMENTS_FOR_ANALYSIS)} 篇文档进行分析
                </p>
              </div>
            )}

            {!isAnalyzing && analysisError && (
              <div className="flex flex-col items-center justify-center py-6">
                <div className="w-10 h-10 mb-3 flex items-center justify-center bg-red-100 dark:bg-red-900/30 rounded-full">
                  <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <p className="text-sm text-red-600 dark:text-red-400 mb-2">{analysisError}</p>
                {filteredDocuments.length === 0 && (
                  <p className="text-xs text-notion-text-secondary/60">
                    知识库为空或当前筛选条件没有匹配的文档
                  </p>
                )}
              </div>
            )}

            {!isAnalyzing && !analysisError && !analysisResult && (
              <div className="flex flex-col items-center justify-center py-8">
                <div className="w-12 h-12 mb-3 flex items-center justify-center bg-notion-accent/10 rounded-full">
                  <svg className="w-6 h-6 text-notion-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                  </svg>
                </div>
                <p className="text-sm text-notion-text-secondary mb-1">发现文档之间的关联关系</p>
                <p className="text-xs text-notion-text-secondary/60 mb-4 text-center max-w-xs">
                  点击上方按钮，AI 将分析文档之间的关联关系、概念依赖，并推荐学习路径
                </p>
                {(!config.apiKey || !config.baseURL) && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    ⚠️ 请先在设置中配置 API 参数
                  </p>
                )}
              </div>
            )}

            {!isAnalyzing && !analysisError && analysisResult && (
              <div className="flex flex-col gap-4">
                {isAnalysisResultStale && (
                  <div className="flex items-center justify-between p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-amber-500">⚠️</span>
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        筛选条件已变化，当前分析结果可能已过期
                      </p>
                    </div>
                    <button
                      onClick={analyzeCrossDocument}
                      className="text-xs px-2 py-1 bg-amber-500 text-white rounded hover:bg-amber-600 transition-colors"
                    >
                      重新分析
                    </button>
                  </div>
                )}

                {analysisResult.keyInsights.length > 0 && (
                  <div>
                    <h4 className="text-[11px] font-medium text-notion-text mb-2 flex items-center gap-1">
                      <span className="text-notion-accent">💡</span> 关键洞察
                    </h4>
                    <div className="flex flex-col gap-1.5">
                      {analysisResult.keyInsights.map((insight, idx) => (
                        <div
                          key={idx}
                          className="px-3 py-2 bg-notion-accent/5 border border-notion-accent/20 rounded-lg text-xs text-notion-text-secondary"
                        >
                          {insight}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {analysisResult.overallRecommendation && (
                  <div>
                    <h4 className="text-[11px] font-medium text-notion-text mb-2 flex items-center gap-1">
                      <span className="text-notion-accent">📋</span> 整体建议
                    </h4>
                    <p className="text-xs text-notion-text-secondary leading-relaxed">
                      {analysisResult.overallRecommendation}
                    </p>
                  </div>
                )}

                {analysisResult.recommendedLearningPath.length > 0 && (
                  <div>
                    <h4 className="text-[11px] font-medium text-notion-text mb-2 flex items-center gap-1">
                      <span className="text-notion-accent">🛤️</span> 推荐学习路径
                    </h4>
                    <div className="flex flex-col gap-2">
                      {analysisResult.recommendedLearningPath.map((step, idx) => {
                        const docTitle = getDocTitleByPageKey(step.pageKey)
                        return (
                          <div
                            key={idx}
                            className="flex items-start gap-2 p-2 bg-notion-bg rounded-lg border border-notion-border/50 cursor-pointer hover:border-notion-accent/30 transition-colors"
                            onClick={() => handleViewDocumentByPageKey(step.pageKey)}
                          >
                            <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-notion-accent text-white rounded-full text-xs font-bold">
                              {idx + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-medium text-notion-text truncate">
                                  {docTitle}
                                </span>
                                <span
                                  className={`text-[9px] px-1.5 py-0.5 rounded-full ${getDifficultyColor(
                                    step.estimatedDifficulty
                                  )}`}
                                >
                                  {getDifficultyLabel(step.estimatedDifficulty)}
                                </span>
                              </div>
                              <p className="text-[10px] text-notion-text-secondary/80 line-clamp-2">
                                {step.reason}
                              </p>
                              {step.prerequisites.length > 0 && (
                                <div className="flex items-center gap-1 mt-1">
                                  <span className="text-[9px] text-notion-text-secondary/50">前置：</span>
                                  {step.prerequisites.map((pre, preIdx) => (
                                    <span
                                      key={preIdx}
                                      className="text-[9px] text-notion-text-secondary/60 bg-notion-bg-secondary px-1 rounded"
                                    >
                                      {getDocTitleByPageKey(pre).length > 10
                                        ? getDocTitleByPageKey(pre).slice(0, 10) + "..."
                                        : getDocTitleByPageKey(pre)}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {analysisResult.documentRelations.length > 0 && (
                  <div>
                    <h4 className="text-[11px] font-medium text-notion-text mb-2 flex items-center gap-1">
                      <span className="text-notion-accent">🔗</span> 文档关联关系
                    </h4>
                    <div className="flex flex-col gap-1.5">
                      {analysisResult.documentRelations.slice(0, 10).map((rel, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 p-2 bg-notion-bg rounded-lg text-xs"
                        >
                          <div
                            className="flex-shrink-0 cursor-pointer text-notion-accent hover:underline truncate max-w-[100px]"
                            onClick={() => handleViewDocumentByPageKey(rel.sourcePageKey)}
                            title={getDocTitleByPageKey(rel.sourcePageKey)}
                          >
                            {getDocTitleByPageKey(rel.sourcePageKey).length > 12
                              ? getDocTitleByPageKey(rel.sourcePageKey).slice(0, 12) + "..."
                              : getDocTitleByPageKey(rel.sourcePageKey)}
                          </div>
                          <span
                            className={`flex-shrink-0 text-[9px] px-2 py-0.5 rounded-full ${
                              rel.relationType === "prerequisite"
                                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                : rel.relationType === "complementary"
                                  ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                                  : rel.relationType === "extension"
                                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                    : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400"
                            }`}
                          >
                            {getRelationTypeLabel(rel.relationType)}
                          </span>
                          <svg
                            className="w-3 h-3 text-notion-text-secondary/40 flex-shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <div
                            className="flex-1 cursor-pointer text-notion-text hover:text-notion-accent truncate"
                            onClick={() => handleViewDocumentByPageKey(rel.targetPageKey)}
                            title={getDocTitleByPageKey(rel.targetPageKey)}
                          >
                            {getDocTitleByPageKey(rel.targetPageKey).length > 12
                              ? getDocTitleByPageKey(rel.targetPageKey).slice(0, 12) + "..."
                              : getDocTitleByPageKey(rel.targetPageKey)}
                          </div>
                          <span className="text-[9px] text-notion-text-secondary/40 flex-shrink-0">
                            {Math.round(rel.strength * 100)}%
                          </span>
                        </div>
                      ))}
                      {analysisResult.documentRelations.length > 10 && (
                        <p className="text-xs text-notion-text-secondary/60 text-center py-1">
                          +{analysisResult.documentRelations.length - 10} 更多关联
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {analysisResult.conceptRelations.length > 0 && (
                  <div>
                    <h4 className="text-[11px] font-medium text-notion-text mb-2 flex items-center gap-1">
                      <span className="text-notion-accent">📚</span> 概念关系
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {analysisResult.conceptRelations.slice(0, 15).map((concept, idx) => (
                        <div
                          key={idx}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] ${
                            concept.relationType === "common"
                              ? "bg-notion-accent/10 text-notion-accent"
                              : concept.relationType === "complementary"
                                ? "bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400"
                                : concept.relationType === "dependent"
                                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
                                  : "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                          }`}
                          title={concept.description}
                        >
                          <span className="font-medium">{concept.concept}</span>
                          <span className="opacity-60">
                            ({getConceptRelationTypeLabel(concept.relationType)})
                          </span>
                          <span className="opacity-40">×{concept.appearingDocuments.length}</span>
                        </div>
                      ))}
                      {analysisResult.conceptRelations.length > 15 && (
                        <span className="text-xs text-notion-text-secondary/60">
                          +{analysisResult.conceptRelations.length - 15}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {filteredDocuments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
            {searchQuery || selectedStage !== "全部" ? (
              <>
                <svg
                  className="w-12 h-12 text-notion-border mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <p className="text-sm text-notion-text-secondary">没有找到匹配的文档</p>
                <p className="text-xs text-notion-text-secondary mt-1 opacity-60">请尝试调整搜索词或筛选条件</p>
              </>
            ) : (
              <>
                <svg
                  className="w-12 h-12 text-notion-border mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
                <p className="text-sm text-notion-text-secondary">知识库为空</p>
                <p className="text-xs text-notion-text-secondary mt-1 opacity-60">
                  开始对话后，点击生成知识文档
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {filteredDocuments.map((doc) => {
              const docCommonConcepts = commonConcepts.filter((c) =>
                c.documents.some((d) => d.pageKey === doc.pageKey)
              )
              const relatedDocTitles = getRelatedDocTitles(doc.pageKey, docCommonConcepts)

              return (
                <div
                  key={doc.pageKey}
                  onClick={() => onViewDocument(doc)}
                  className="p-3 bg-notion-bg-secondary/50 rounded-xl border border-notion-border/30 hover:bg-notion-bg-secondary hover:border-notion-border/50 transition-all cursor-pointer group"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-notion-accent/10 rounded-lg flex-shrink-0 flex items-center justify-center group-hover:bg-notion-accent/20 transition-colors">
                      <span className="text-lg">{getStageIcon(doc.understandingStatus.currentStage)}</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <h3 className="text-sm font-medium text-notion-text truncate group-hover:text-notion-accent transition-colors">
                          {doc.pageTitle || "未命名文档"}
                        </h3>
                        <svg
                          className="w-4 h-4 text-notion-text-secondary/40 group-hover:text-notion-accent transition-colors flex-shrink-0"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </div>

                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] text-notion-text-secondary/60 truncate">
                          {doc.pageUrl ? extractHostname(doc.pageUrl) : "未知来源"}
                        </span>
                      </div>

                      <p className="text-xs text-notion-text-secondary/80 line-clamp-2 mb-2.5">
                        {doc.summary}
                      </p>

                      <div className="flex items-center flex-wrap gap-1.5">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${getStageColor(
                            doc.understandingStatus.currentStage
                          )}`}
                        >
                          {doc.understandingStatus.currentStage}
                        </span>

                        <span className="text-[10px] text-notion-text-secondary/60">
                          概念 {doc.keyConcepts.length} · 卡片 {doc.knowledgeCards.length}
                        </span>

                        {doc.understandingStatus.mastered.length > 0 && (
                          <span className="text-[9px] text-green-600 dark:text-green-400">
                            ✓{doc.understandingStatus.mastered.length}
                          </span>
                        )}

                        {doc.understandingStatus.pendingClarification.length > 0 && (
                          <span className="text-[9px] text-amber-600 dark:text-amber-400">
                            ⚠{doc.understandingStatus.pendingClarification.length}
                          </span>
                        )}

                        <span className="text-[9px] text-notion-text-secondary/40 ml-auto">
                          {formatTime(doc.updatedAt)}
                        </span>
                      </div>

                      {docCommonConcepts.length > 0 && (
                        <div className="mt-2.5">
                          <div className="flex items-center flex-wrap gap-1.5">
                            <span className="text-[9px] text-notion-accent">
                              🔗{docCommonConcepts.length} 关联
                            </span>
                            {relatedDocTitles.length > 0 && (
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] text-notion-text-secondary/40">→</span>
                                {relatedDocTitles.map((title, idx) => (
                                  <span
                                    key={idx}
                                    className="text-[9px] text-notion-text-secondary/70 bg-notion-bg-secondary/80 px-1.5 py-0.5 rounded"
                                  >
                                    {title.length > 15 ? title.slice(0, 15) + "..." : title}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {doc.keyConcepts.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {doc.keyConcepts.slice(0, 5).map((concept, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center px-1.5 py-0.5 bg-notion-accent/5 text-notion-accent/70 rounded text-[9px]"
                            >
                              {concept.name}
                            </span>
                          ))}
                          {doc.keyConcepts.length > 5 && (
                            <span className="text-[9px] text-notion-text-secondary/40">
                              +{doc.keyConcepts.length - 5}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
