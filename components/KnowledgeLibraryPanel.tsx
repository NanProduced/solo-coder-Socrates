import { useState, useMemo } from "react"
import { KnowledgeDocument, CrossDocAnalysis, ReviewSchedule } from "../lib/types"
import { ConceptGraph } from "./ConceptGraph"

interface KnowledgeLibraryPanelProps {
  allDocs: KnowledgeDocument[]
  isLoading: boolean
  onOpenDoc: (pageKey: string) => void
  onDeleteDocs: (pageKeys: string[]) => void
  onExportAll: () => void
  onAnalyzeRelations: () => void
  onStartReview: () => void
  crossDocAnalysis: CrossDocAnalysis | null
  isAnalyzing: boolean
  isExporting: boolean
  dueReviewCount: number
}

const STAGE_CONFIG: Record<string, { color: string; bg: string; dot: string }> = {
  "融会贯通": { color: "text-green-700 dark:text-green-400", bg: "bg-green-50 dark:bg-green-900/20", dot: "bg-green-500" },
  "深入理解": { color: "text-yellow-700 dark:text-yellow-400", bg: "bg-yellow-50 dark:bg-yellow-900/20", dot: "bg-yellow-500" },
  "建立框架": { color: "text-orange-700 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-900/20", dot: "bg-orange-500" },
  "初步接触": { color: "text-red-700 dark:text-red-400", bg: "bg-red-50 dark:bg-red-900/20", dot: "bg-red-500" },
}

const DEFAULT_STAGE = { color: "text-notion-text-secondary", bg: "bg-notion-bg-secondary", dot: "bg-notion-text-secondary" }

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

function formatTime(timestamp: number): string {
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
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) + " " + date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
}

function getTimeGroupLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)

  if (date >= today) return "今天"
  if (date >= yesterday) return "昨天"
  return "更早"
}

type LibraryView = "list" | "analysis"

export const KnowledgeLibraryPanel = ({
  allDocs,
  isLoading,
  onOpenDoc,
  onDeleteDocs,
  onExportAll,
  onAnalyzeRelations,
  onStartReview,
  crossDocAnalysis,
  isAnalyzing,
  isExporting,
  dueReviewCount,
}: KnowledgeLibraryPanelProps) => {
  const [searchQuery, setSearchQuery] = useState("")
  const [stageFilter, setStageFilter] = useState<string>("all")
  const [editMode, setEditMode] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [currentView, setCurrentView] = useState<LibraryView>("list")

  const filteredDocs = useMemo(() => {
    let docs = allDocs

    if (stageFilter !== "all") {
      docs = docs.filter((d) => d.understandingStatus.currentStage === stageFilter)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      docs = docs.filter((d) => {
        if (d.pageTitle.toLowerCase().includes(q)) return true
        if (d.summary.toLowerCase().includes(q)) return true
        if (d.keyConcepts.some((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))) return true
        if (d.knowledgeCards.some((c) => c.concept.toLowerCase().includes(q) || c.explanation.toLowerCase().includes(q))) return true
        return false
      })
    }

    return docs
  }, [allDocs, searchQuery, stageFilter])

  const groupedDocs = useMemo(() => {
    const groups: { label: string; docs: KnowledgeDocument[] }[] = []
    const groupMap = new Map<string, KnowledgeDocument[]>()

    for (const doc of filteredDocs) {
      const label = getTimeGroupLabel(doc.updatedAt)
      if (!groupMap.has(label)) {
        groupMap.set(label, [])
      }
      groupMap.get(label)!.push(doc)
    }

    const order = ["今天", "昨天", "更早"]
    for (const label of order) {
      if (groupMap.has(label)) {
        groups.push({ label, docs: groupMap.get(label)! })
      }
    }

    return groups
  }, [filteredDocs])

  const toggleSelect = (pageKey: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(pageKey)) {
        next.delete(pageKey)
      } else {
        next.add(pageKey)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedKeys.size === filteredDocs.length) {
      setSelectedKeys(new Set())
    } else {
      setSelectedKeys(new Set(filteredDocs.map((d) => d.pageKey)))
    }
  }

  const exitEditMode = () => {
    setEditMode(false)
    setSelectedKeys(new Set())
    setConfirmDelete(false)
  }

  const handleDeleteSelected = () => {
    if (selectedKeys.size > 0) {
      onDeleteDocs(Array.from(selectedKeys))
      setSelectedKeys(new Set())
      setConfirmDelete(false)
      setEditMode(false)
    }
  }

  const totalConcepts = allDocs.reduce((sum, d) => sum + d.keyConcepts.length, 0)
  const totalCards = allDocs.reduce((sum, d) => sum + d.knowledgeCards.length, 0)

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-notion-bg/95 backdrop-blur-md border-b border-notion-border">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold">📚 知识库</h2>
            {!editMode && allDocs.length > 0 && (
              <span className="text-[10px] text-notion-text-secondary">
                {allDocs.length} 文档 · {totalConcepts} 概念 · {totalCards} 卡片
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {editMode ? (
              <>
                <button
                  onClick={toggleSelectAll}
                  className="text-[11px] text-notion-accent hover:text-notion-accent-hover font-medium px-2 py-1 transition-colors"
                >
                  {selectedKeys.size === filteredDocs.length ? "取消全选" : "全选"}
                </button>
                <button
                  onClick={exitEditMode}
                  className="text-[11px] text-notion-text-secondary hover:text-notion-text font-medium px-2 py-1 transition-colors"
                >
                  完成
                </button>
              </>
            ) : (
              <>
                {allDocs.length > 0 && (
                  <button
                    onClick={() => setEditMode(true)}
                    className="text-[11px] text-notion-accent hover:text-notion-accent-hover font-medium transition-colors"
                  >
                    管理
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {editMode && selectedKeys.size > 0 && (
          <div className="px-4 pb-2 flex items-center gap-2">
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-[11px] font-medium px-3 py-1.5 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500/20 transition-colors"
              >
                删除所选 ({selectedKeys.size})
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-red-500">确认删除？</span>
                <button
                  onClick={handleDeleteSelected}
                  className="text-[11px] font-medium px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                >
                  删除
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-[11px] text-notion-text-secondary hover:text-notion-text px-2 py-1 transition-colors"
                >
                  取消
                </button>
              </div>
            )}
          </div>
        )}

        {!editMode && (
          <div className="px-4 pb-3 space-y-2">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-notion-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索知识点..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-notion-bg-secondary rounded-lg border border-notion-border/50 focus:outline-none focus:border-notion-accent/50 placeholder:text-notion-text-secondary/50 transition-colors"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                className="text-[11px] px-2 py-1 bg-notion-bg-secondary rounded-lg border border-notion-border/50 focus:outline-none focus:border-notion-accent/50 text-notion-text-secondary transition-colors"
              >
                <option value="all">全部阶段</option>
                <option value="初步接触">🔴 初步接触</option>
                <option value="建立框架">🟠 建立框架</option>
                <option value="深入理解">🟡 深入理解</option>
                <option value="融会贯通">🟢 融会贯通</option>
              </select>
              {allDocs.length >= 2 && (
                <div className="flex items-center gap-0.5 ml-auto">
                  <button
                    onClick={() => setCurrentView("list")}
                    className={`px-2 py-1 rounded-lg text-[11px] transition-colors ${currentView === "list" ? "bg-notion-accent/10 text-notion-accent font-medium" : "text-notion-text-secondary hover:bg-notion-hover"}`}
                  >
                    列表
                  </button>
                  <button
                    onClick={() => setCurrentView("analysis")}
                    className={`px-2 py-1 rounded-lg text-[11px] transition-colors ${currentView === "analysis" ? "bg-notion-accent/10 text-notion-accent font-medium" : "text-notion-text-secondary hover:bg-notion-hover"}`}
                  >
                    关联
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isLoading ? (
          <div className="p-5 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="h-4 bg-notion-bg-secondary rounded w-3/4 mb-2" />
                <div className="h-3 bg-notion-bg-secondary rounded w-1/2 mb-1" />
                <div className="h-3 bg-notion-bg-secondary rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : currentView === "analysis" ? (
          <div className="p-4 space-y-4">
            {!crossDocAnalysis && !isAnalyzing && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <svg className="w-10 h-10 text-notion-border mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <p className="text-sm text-notion-text-secondary mb-3">发现文档之间的知识关联</p>
                <button
                  onClick={onAnalyzeRelations}
                  className="text-xs font-medium px-4 py-2 bg-notion-accent text-white rounded-lg hover:bg-notion-accent-hover transition-colors"
                >
                  开始分析
                </button>
              </div>
            )}

            {isAnalyzing && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-8 h-8 border-2 border-notion-accent border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-sm text-notion-text-secondary">正在分析文档关联...</p>
              </div>
            )}

            {crossDocAnalysis && !isAnalyzing && (
              <>
                <ConceptGraph
                  analysis={crossDocAnalysis}
                  docs={allDocs}
                  onDocClick={onOpenDoc}
                />

                {crossDocAnalysis.summary && (
                  <div className="p-3 bg-notion-bg-secondary rounded-xl border border-notion-border/30">
                    <h3 className="text-xs font-semibold text-notion-text-secondary uppercase tracking-wider mb-2">关联摘要</h3>
                    <p className="text-xs text-notion-text leading-relaxed">{crossDocAnalysis.summary}</p>
                  </div>
                )}

                {crossDocAnalysis.relations.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-notion-text-secondary uppercase tracking-wider mb-2">概念关联</h3>
                    <div className="space-y-2">
                      {crossDocAnalysis.relations.map((rel, idx) => {
                        const relDocs = rel.docPageKeys
                          .map((pk) => allDocs.find((d) => d.pageKey === pk))
                          .filter(Boolean)
                        const typeLabel = rel.relationType === "shared" ? "共同概念" : rel.relationType === "complementary" ? "互补" : "依赖"
                        const typeColor = rel.relationType === "shared" ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20" : rel.relationType === "complementary" ? "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20" : "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20"

                        return (
                          <div
                            key={idx}
                            className="p-3 bg-notion-bg-secondary rounded-xl border border-notion-border/30"
                          >
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-sm font-semibold text-notion-text">{rel.conceptName}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${typeColor}`}>
                                {typeLabel}
                              </span>
                            </div>
                            <p className="text-xs text-notion-text-secondary mb-2">{rel.description}</p>
                            <div className="flex flex-wrap gap-1">
                              {relDocs.map((doc) => (
                                <button
                                  key={doc!.pageKey}
                                  onClick={() => onOpenDoc(doc!.pageKey)}
                                  className="text-[10px] px-2 py-0.5 bg-notion-accent/10 text-notion-accent rounded-full hover:bg-notion-accent/20 transition-colors"
                                >
                                  {doc!.pageTitle}
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {crossDocAnalysis.suggestedPath.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-notion-text-secondary uppercase tracking-wider mb-2">建议学习路径</h3>
                    <div className="space-y-1.5">
                      {crossDocAnalysis.suggestedPath.map((title, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <div className="w-5 h-5 bg-notion-accent/10 rounded-full flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] font-bold text-notion-accent">{idx + 1}</span>
                          </div>
                          <span className="text-xs text-notion-text">{title}</span>
                          {idx < crossDocAnalysis.suggestedPath.length - 1 && (
                            <svg className="w-3 h-3 text-notion-text-secondary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <button
                    onClick={onAnalyzeRelations}
                    disabled={isAnalyzing}
                    className="text-[11px] text-notion-accent hover:text-notion-accent-hover font-medium transition-colors disabled:opacity-50"
                  >
                    重新分析
                  </button>
                </div>
              </>
            )}
          </div>
        ) : allDocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
            <svg className="w-12 h-12 text-notion-border mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <p className="text-sm text-notion-text-secondary">知识库为空</p>
            <p className="text-xs text-notion-text-secondary mt-1 opacity-60">阅读文档并生成知识文档后，它们会出现在这里</p>
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
            <svg className="w-10 h-10 text-notion-border mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-sm text-notion-text-secondary">没有匹配的文档</p>
            <p className="text-xs text-notion-text-secondary mt-1 opacity-60">尝试调整搜索词或筛选条件</p>
          </div>
        ) : (
          <div className="p-3">
            {groupedDocs.map((group) => (
              <div key={group.label} className="mb-4">
                <div className="px-2 py-1.5 mb-1">
                  <span className="text-[11px] font-semibold text-notion-text-secondary uppercase tracking-wider">
                    {group.label}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {group.docs.map((doc) => {
                    const stage = doc.understandingStatus.currentStage
                    const stageCfg = STAGE_CONFIG[stage] || DEFAULT_STAGE

                    return (
                      <div
                        key={doc.pageKey}
                        className={`relative rounded-lg transition-colors ${
                          editMode
                            ? selectedKeys.has(doc.pageKey)
                              ? "bg-notion-accent/5"
                              : "hover:bg-notion-hover/50"
                            : ""
                        }`}
                      >
                        <button
                          onClick={() => {
                            if (editMode) {
                              toggleSelect(doc.pageKey)
                            } else {
                              onOpenDoc(doc.pageKey)
                            }
                          }}
                          className="w-full px-3 py-2.5 rounded-lg transition-colors text-left hover:bg-notion-hover group"
                        >
                          <div className="flex items-start gap-2.5">
                            {editMode && (
                              <div
                                className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center mt-1 transition-colors ${
                                  selectedKeys.has(doc.pageKey)
                                    ? "bg-notion-accent"
                                    : "bg-notion-bg-secondary border border-notion-border"
                                }`}
                              >
                                {selectedKeys.has(doc.pageKey) && (
                                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </div>
                            )}
                            <div className="w-7 h-7 bg-notion-bg-secondary rounded-lg flex-shrink-0 flex items-center justify-center border border-notion-border/50 mt-0.5">
                              <svg className="w-3.5 h-3.5 text-notion-accent/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                              </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium truncate">
                                  {doc.pageTitle || "未命名文档"}
                                </span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${stageCfg.bg} ${stageCfg.color}`}>
                                  {stage}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[10px] text-notion-text-secondary">
                                  {doc.keyConcepts.length} 概念 · {doc.knowledgeCards.length} 卡片
                                </span>
                                <span className="text-[10px] text-notion-text-secondary opacity-40">·</span>
                                <span className="text-[10px] text-notion-text-secondary truncate">
                                  {extractHostname(doc.pageUrl)}
                                </span>
                                <span className="text-[10px] text-notion-text-secondary opacity-40">·</span>
                                <span className="text-[10px] text-notion-text-secondary flex-shrink-0">
                                  {formatTime(doc.updatedAt)}
                                </span>
                              </div>
                            </div>
                            {!editMode && (
                              <svg className="w-4 h-4 text-notion-text-secondary opacity-0 group-hover:opacity-50 flex-shrink-0 mt-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            )}
                          </div>
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!editMode && allDocs.length > 0 && (
        <div className="border-t border-notion-border bg-notion-bg px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {dueReviewCount > 0 && (
              <button
                onClick={onStartReview}
                className="text-[11px] font-medium px-3 py-1.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg hover:bg-amber-500/20 transition-colors"
              >
                📝 复习 ({dueReviewCount})
              </button>
            )}
            {allDocs.length >= 2 && (
              <button
                onClick={onAnalyzeRelations}
                disabled={isAnalyzing}
                className="text-[11px] font-medium px-3 py-1.5 bg-notion-accent/10 text-notion-accent rounded-lg hover:bg-notion-accent/20 transition-colors disabled:opacity-50"
              >
                {isAnalyzing ? "分析中..." : "📊 分析关联"}
              </button>
            )}
          </div>
          <button
            onClick={onExportAll}
            disabled={isExporting}
            className="text-[11px] font-medium px-3 py-1.5 bg-notion-bg-secondary text-notion-text-secondary rounded-lg hover:bg-notion-hover transition-colors disabled:opacity-50"
          >
            {isExporting ? "导出中..." : "📥 导出全部"}
          </button>
        </div>
      )}
    </div>
  )
}
