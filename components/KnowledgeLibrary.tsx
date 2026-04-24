import { useState, useEffect, useMemo, useCallback } from "react"
import { KnowledgeDocument, KeyConcept } from "../lib/types"
import { loadAllKnowledgeDocuments, loadKnowledgeDocument, loadPageConversations } from "../lib/storage"

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
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedStage, setSelectedStage] = useState<LearningStage | "全部">("全部")
  const [showConceptsPanel, setShowConceptsPanel] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<string | null>(null)

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

  const handleAnalyzeCrossDocument = useCallback(async () => {
    setIsAnalyzing(true)
    setAnalysisResult(null)
    try {
      setAnalysisResult(
        "跨文档 LLM 分析功能已预留。\n\n此接口将用于：\n- 生成文档间的相关关系\n- 推荐学习路径\n- 提供跨文档知识关联的推荐理由\n\n实现方式：将所有文档的摘要、关键概念和知识卡片作为上下文，调用 LLM 进行综合分析。"
      )
    } catch (error) {
      console.error("Analysis failed:", error)
    } finally {
      setIsAnalyzing(false)
    }
  }, [])

  const handleViewDocumentByPageKey = useCallback(
    async (pageKey: string) => {
      const doc = await loadKnowledgeDocument(pageKey)
      if (doc) {
        onViewDocument(doc)
      }
    },
    [onViewDocument]
  )

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
            <div className="flex flex-wrap gap-1.5">
              {commonConcepts.slice(0, 20).map((c) => (
                <span
                  key={c.concept}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-notion-accent/10 text-notion-accent rounded-full text-xs cursor-pointer hover:bg-notion-accent/20 transition-colors group"
                  title={`${c.description || ""}\n出现在 ${c.documents.length} 篇文档中`}
                >
                  <span className="font-medium">{c.concept}</span>
                  <span className="text-[9px] opacity-60">×{c.documents.length}</span>
                </span>
              ))}
              {commonConcepts.length > 20 && (
                <span className="text-xs text-notion-text-secondary opacity-60">
                  +{commonConcepts.length - 20} 更多
                </span>
              )}
            </div>
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

                        {docCommonConcepts.length > 0 && (
                          <span className="text-[9px] text-notion-accent">
                            🔗{docCommonConcepts.length} 关联
                          </span>
                        )}

                        <span className="text-[9px] text-notion-text-secondary/40 ml-auto">
                          {formatTime(doc.updatedAt)}
                        </span>
                      </div>

                      {doc.keyConcepts.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2.5">
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

      {documents.length >= 2 && (
        <div className="sticky bottom-0 border-t border-notion-border bg-notion-bg/95 backdrop-blur-md">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] text-notion-text-secondary font-medium">跨文档分析</p>
                <p className="text-[10px] text-notion-text-secondary/60">
                  预留接口：生成相关关系、学习路径、推荐理由
                </p>
              </div>
              <button
                onClick={handleAnalyzeCrossDocument}
                disabled={isAnalyzing}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-notion-accent/10 text-notion-accent rounded-lg text-xs font-medium hover:bg-notion-accent/20 transition-colors disabled:opacity-50"
              >
                {isAnalyzing ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
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
                <span>{isAnalyzing ? "分析中..." : "智能分析"}</span>
              </button>
            </div>

            {analysisResult && (
              <div className="mt-3 p-3 bg-notion-bg-secondary/50 rounded-lg border border-notion-border/30">
                <pre className="text-xs text-notion-text-secondary whitespace-pre-wrap leading-relaxed">
                  {analysisResult}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
