import { KnowledgeDocument } from "../lib/types"

interface KnowledgePanelProps {
  knowledgeDoc: KnowledgeDocument | null
  isGeneratingDoc: boolean
  isExporting: boolean
  onClose: () => void
  onUpdate: () => void
  onExport: () => void
  onBackToLibrary?: () => void
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
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) + " " + date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
}

export const KnowledgePanel = ({
  knowledgeDoc,
  isGeneratingDoc,
  isExporting,
  onClose,
  onUpdate,
  onExport,
  onBackToLibrary,
}: KnowledgePanelProps) => {
  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-notion-bg/95 backdrop-blur-md border-b border-notion-border">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onBackToLibrary ? (
              <button
                onClick={onBackToLibrary}
                className="text-notion-text-secondary hover:text-notion-text transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            ) : (
              <button
                onClick={onClose}
                className="text-notion-text-secondary hover:text-notion-text transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h2 className="text-sm font-bold">知识文档</h2>
          </div>
          <div className="flex items-center gap-1">
            {knowledgeDoc && !isGeneratingDoc && (
              <>
                <button
                  onClick={onUpdate}
                  disabled={isGeneratingDoc}
                  className="text-[11px] text-notion-accent hover:text-notion-accent-hover font-medium transition-colors disabled:opacity-50"
                >
                  更新
                </button>
                <span className="text-notion-border">|</span>
                <button
                  onClick={onExport}
                  disabled={isExporting}
                  className="text-[11px] text-notion-accent hover:text-notion-accent-hover font-medium transition-colors disabled:opacity-50"
                >
                  {isExporting ? "导出中..." : "导出"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isGeneratingDoc ? (
          <div className="p-5 space-y-6">
            <div className="animate-pulse">
              <div className="h-3 bg-notion-bg-secondary rounded w-16 mb-3" />
              <div className="h-20 bg-notion-bg-secondary rounded-xl" />
            </div>
            <div className="animate-pulse">
              <div className="h-3 bg-notion-bg-secondary rounded w-20 mb-3" />
              <div className="flex gap-2 flex-wrap">
                <div className="h-6 w-16 bg-notion-bg-secondary rounded-full" />
                <div className="h-6 w-20 bg-notion-bg-secondary rounded-full" />
                <div className="h-6 w-14 bg-notion-bg-secondary rounded-full" />
              </div>
            </div>
            <div className="animate-pulse">
              <div className="h-3 bg-notion-bg-secondary rounded w-16 mb-3" />
              <div className="space-y-3">
                <div className="h-24 bg-notion-bg-secondary rounded-xl" />
                <div className="h-24 bg-notion-bg-secondary rounded-xl" />
              </div>
            </div>
            <div className="animate-pulse">
              <div className="h-3 bg-notion-bg-secondary rounded w-16 mb-3" />
              <div className="h-32 bg-notion-bg-secondary rounded-xl" />
            </div>
          </div>
        ) : knowledgeDoc ? (
          <div className="p-5 space-y-6">
            <div>
              <h3 className="text-xs font-semibold text-notion-text-secondary uppercase tracking-wider mb-2">摘要</h3>
              <p className="text-sm text-notion-text leading-relaxed">{knowledgeDoc.summary}</p>
            </div>

            {knowledgeDoc.keyConcepts.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-notion-text-secondary uppercase tracking-wider mb-2">关键概念</h3>
                <div className="flex flex-wrap gap-1.5">
                  {knowledgeDoc.keyConcepts.map((concept, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center px-2.5 py-1 bg-notion-accent/10 text-notion-accent rounded-full text-xs font-medium"
                    >
                      {concept.name}
                    </span>
                  ))}
                </div>
                <div className="mt-3 space-y-2">
                  {knowledgeDoc.keyConcepts.map((concept, idx) => (
                    <div key={idx} className="text-xs text-notion-text-secondary">
                      <span className="font-medium text-notion-text">{concept.name}</span>: {concept.description}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {knowledgeDoc.knowledgeCards.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-notion-text-secondary uppercase tracking-wider mb-2">知识卡片</h3>
                <div className="space-y-3">
                  {knowledgeDoc.knowledgeCards.map((card, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-notion-bg-secondary rounded-xl border border-notion-border/30"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="w-5 h-5 bg-notion-accent/10 rounded flex items-center justify-center flex-shrink-0">
                          <span className="text-[10px] font-bold text-notion-accent">{idx + 1}</span>
                        </div>
                        <span className="text-sm font-semibold text-notion-text">{card.concept}</span>
                      </div>
                      <p className="text-xs text-notion-text-secondary mb-2 pl-7">{card.explanation}</p>
                      {card.keyPoints.length > 0 && (
                        <ul className="space-y-1 pl-7">
                          {card.keyPoints.map((point, pIdx) => (
                            <li key={pIdx} className="text-xs text-notion-text-secondary flex items-start gap-1.5">
                              <span className="text-notion-accent/60 mt-0.5 flex-shrink-0">·</span>
                              <span>{point}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="text-xs font-semibold text-notion-text-secondary uppercase tracking-wider mb-2">理解状态</h3>
              <div className="p-3 bg-notion-bg-secondary rounded-xl border border-notion-border/30 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-notion-text-secondary">当前阶段</span>
                  <span className="text-xs font-semibold text-notion-accent px-2 py-0.5 bg-notion-accent/10 rounded-full">
                    {knowledgeDoc.understandingStatus.currentStage}
                  </span>
                </div>
                {knowledgeDoc.understandingStatus.mastered.length > 0 && (
                  <div>
                    <span className="text-xs text-green-600 dark:text-green-400 font-medium">✓ 已掌握</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {knowledgeDoc.understandingStatus.mastered.map((item, idx) => (
                        <span key={idx} className="text-[11px] px-2 py-0.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-full">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {knowledgeDoc.understandingStatus.pendingClarification.length > 0 && (
                  <div>
                    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">⚠ 待澄清</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {knowledgeDoc.understandingStatus.pendingClarification.map((item, idx) => (
                        <span key={idx} className="text-[11px] px-2 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-full">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <span className="text-xs text-notion-text-secondary font-medium">证据状态</span>
                  <p className="text-xs text-notion-text mt-0.5">{knowledgeDoc.understandingStatus.evidenceStatus}</p>
                </div>
                {knowledgeDoc.understandingStatus.nextThinkingDirection && (
                  <div>
                    <span className="text-xs text-notion-text-secondary font-medium">💡 下一步思考</span>
                    <p className="text-xs text-notion-text mt-0.5">{knowledgeDoc.understandingStatus.nextThinkingDirection}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="text-center pt-2 pb-4">
              <span className="text-[10px] text-notion-text-secondary opacity-60">
                更新于 {formatTime(knowledgeDoc.updatedAt)}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
            <svg className="w-12 h-12 text-notion-border mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <p className="text-sm text-notion-text-secondary">暂无知识文档</p>
            <p className="text-xs text-notion-text-secondary mt-1 opacity-60">开始对话后，点击生成知识文档</p>
          </div>
        )}
      </div>
    </div>
  )
}
