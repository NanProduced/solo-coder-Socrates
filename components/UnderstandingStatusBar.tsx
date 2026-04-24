import { UnderstandingStatus } from "../lib/types"

interface UnderstandingStatusBarProps {
  understandingStatus: UnderstandingStatus | null
  isUpdatingStatus: boolean
  showStatusDetail: boolean
  setShowStatusDetail: (v: boolean) => void
  showKnowledgePanel: boolean
}

export const UnderstandingStatusBar = ({
  understandingStatus,
  isUpdatingStatus,
  showStatusDetail,
  setShowStatusDetail,
  showKnowledgePanel,
}: UnderstandingStatusBarProps) => {
  if (!understandingStatus || showKnowledgePanel) return null

  return (
    <div className="px-4 pt-3">
      <button
        onClick={() => setShowStatusDetail(!showStatusDetail)}
        className="w-full text-left"
      >
        <div className="flex items-center gap-2 text-xs text-notion-text-secondary">
          <span className="font-medium text-notion-accent">{understandingStatus.currentStage}</span>
          <span className="text-notion-border">|</span>
          <span className="text-green-600 dark:text-green-400">✓ {understandingStatus.mastered.length}已掌握</span>
          <span className="text-notion-border">|</span>
          <span className="text-amber-600 dark:text-amber-400">⚠ {understandingStatus.pendingClarification.length}待澄清</span>
          {isUpdatingStatus && (
            <svg className="w-3 h-3 animate-spin text-notion-accent" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          )}
          <svg className={`w-3 h-3 ml-auto transition-transform ${showStatusDetail ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${showStatusDetail ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <div className="pt-2 pb-1 space-y-2">
            {understandingStatus.mastered.length > 0 && (
              <div>
                <span className="text-[11px] text-green-600 dark:text-green-400 font-medium">✓ 已掌握</span>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {understandingStatus.mastered.map((item, idx) => (
                    <span key={idx} className="text-[10px] px-1.5 py-0.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-full">{item}</span>
                  ))}
                </div>
              </div>
            )}
            {understandingStatus.pendingClarification.length > 0 && (
              <div>
                <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">⚠ 待澄清</span>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {understandingStatus.pendingClarification.map((item, idx) => (
                    <span key={idx} className="text-[10px] px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-full">{item}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="text-[11px] text-notion-text-secondary">
              <span className="font-medium">证据状态</span>: {understandingStatus.evidenceStatus}
            </div>
            {understandingStatus.nextThinkingDirection && (
              <div className="text-[11px] text-notion-text-secondary">
                <span className="font-medium">💡 下一步</span>: {understandingStatus.nextThinkingDirection}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
