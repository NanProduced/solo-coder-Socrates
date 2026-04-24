import { UnderstandingStatus } from "../lib/types"

interface UnderstandingStatusBarProps {
  understandingStatus: UnderstandingStatus
  showStatusDetail: boolean
  onToggleDetail: () => void
  isUpdatingStatus: boolean
}

export const UnderstandingStatusBar = ({
  understandingStatus,
  showStatusDetail,
  onToggleDetail,
  isUpdatingStatus,
}: UnderstandingStatusBarProps) => {
  return (
    <div className="px-4 pt-3">
      <button
        onClick={onToggleDetail}
        className="w-full text-left"
      >
        <div className="flex items-center gap-2 text-xs text-notion-text-secondary">
          <span className="font-medium text-notion-accent">{understandingStatus.currentStage}</span>
          <span className="text-green-600 dark:text-green-400">已掌握 {understandingStatus.mastered.length}</span>
          <span className="text-amber-600 dark:text-amber-400">待澄清 {understandingStatus.pendingClarification.length}</span>
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
          <div className="pt-2 pb-1 space-y-1.5">
            {understandingStatus.mastered.length > 0 && (
              <div>
                <span className="text-[11px] text-green-600 dark:text-green-400 font-medium">已掌握</span>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {understandingStatus.mastered.map((item, idx) => (
                    <span key={idx} className="text-[10px] px-1.5 py-0.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-full">{item}</span>
                  ))}
                </div>
              </div>
            )}
            {understandingStatus.pendingClarification.length > 0 && (
              <div>
                <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">待澄清</span>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {understandingStatus.pendingClarification.map((item, idx) => (
                    <span key={idx} className="text-[10px] px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-full">{item}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="text-[11px] text-notion-text-secondary">
              理解信心: {understandingStatus.evidenceStatus}
            </div>
            {understandingStatus.nextThinkingDirection && (
              <div className="text-[11px] text-notion-text-secondary flex items-start gap-1">
                <svg className="w-3 h-3 mt-0.5 text-notion-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <span>{understandingStatus.nextThinkingDirection}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
