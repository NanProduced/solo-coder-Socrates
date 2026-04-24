import { useState } from "react"
import { ReviewSchedule, ReviewQuality, KeyConcept } from "../lib/types"
import { calculateNextReview } from "../lib/spaced-repetition"

interface ReviewPanelProps {
  dueSchedules: ReviewSchedule[]
  conceptMap: Map<string, KeyConcept>
  onReview: (updatedSchedule: ReviewSchedule) => void
  onClose: () => void
}

const QUALITY_CONFIG: { quality: ReviewQuality; label: string; color: string; dotColor: string }[] = [
  { quality: "again", label: "忘了", color: "bg-red-500/10 text-red-500 hover:bg-red-500/20", dotColor: "bg-red-500" },
  { quality: "hard", label: "模糊", color: "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20", dotColor: "bg-amber-500" },
  { quality: "good", label: "记得", color: "bg-green-500/10 text-green-500 hover:bg-green-500/20", dotColor: "bg-green-500" },
  { quality: "easy", label: "熟练", color: "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20", dotColor: "bg-blue-500" },
]

export const ReviewPanel = ({
  dueSchedules,
  conceptMap,
  onReview,
  onClose,
}: ReviewPanelProps) => {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [reviewed, setReviewed] = useState(0)

  const current = dueSchedules[currentIndex]
  const isFinished = currentIndex >= dueSchedules.length

  const handleQuality = (quality: ReviewQuality) => {
    if (!current) return
    const updated = calculateNextReview(current, quality)
    onReview(updated)
    setReviewed((prev) => prev + 1)
    setShowAnswer(false)
    setCurrentIndex((prev) => prev + 1)
  }

  const concept = current ? conceptMap.get(current.conceptName) : null

  if (dueSchedules.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="sticky top-0 z-10 bg-notion-bg border-b border-notion-border px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-bold">复习</h2>
          <button
            onClick={onClose}
            className="p-1 text-notion-text-secondary hover:bg-notion-hover rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <svg className="w-12 h-12 text-notion-border mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-notion-text-secondary">暂无待复习内容</p>
          <p className="text-xs text-notion-text-secondary mt-1 opacity-60">所有知识点都在复习计划内</p>
        </div>
      </div>
    )
  }

  if (isFinished) {
    return (
      <div className="flex flex-col h-full">
        <div className="sticky top-0 z-10 bg-notion-bg border-b border-notion-border px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-bold">复习完成</h2>
          <button
            onClick={onClose}
            className="p-1 text-notion-text-secondary hover:bg-notion-hover rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <svg className="w-12 h-12 text-notion-accent mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm font-medium text-notion-text">复习完成！</p>
          <p className="text-xs text-notion-text-secondary mt-1">已完成 {reviewed} 个知识点的复习</p>
          <button
            onClick={onClose}
            className="mt-6 px-6 py-2 bg-notion-accent text-white rounded-xl text-sm font-bold hover:bg-notion-accent-hover transition-colors"
          >
            返回知识库
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-notion-bg border-b border-notion-border px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">复习</h2>
          <button
            onClick={onClose}
            className="p-1 text-notion-text-secondary hover:bg-notion-hover rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-notion-bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-notion-accent rounded-full transition-all duration-300"
              style={{ width: `${((currentIndex) / dueSchedules.length) * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-notion-text-secondary flex-shrink-0">
            {currentIndex + 1}/{dueSchedules.length}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-5">
        <div className="max-w-md mx-auto">
          <div className="mb-3">
            <span className="text-[10px] px-2 py-0.5 bg-notion-accent/10 text-notion-accent rounded-full font-medium">
              第 {current.reviewCount + 1} 次复习
            </span>
          </div>

          <h3 className="text-lg font-bold text-notion-text mb-4">
            {current.conceptName}
          </h3>

          {!showAnswer ? (
            <div className="py-8 text-center">
              <p className="text-sm text-notion-text-secondary mb-6">回想一下这个概念的含义...</p>
              <button
                onClick={() => setShowAnswer(true)}
                className="px-6 py-2.5 bg-notion-accent text-white rounded-xl text-sm font-bold hover:bg-notion-accent-hover transition-colors"
              >
                显示答案
              </button>
            </div>
          ) : (
            <>
              {concept && (
                <div className="p-4 bg-notion-bg-secondary rounded-xl border border-notion-border/30 mb-6">
                  <p className="text-sm text-notion-text leading-relaxed">{concept.description}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                {QUALITY_CONFIG.map(({ quality, label, color, dotColor }) => (
                  <button
                    key={quality}
                    onClick={() => handleQuality(quality)}
                    className={`px-4 py-3 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2 ${color}`}
                  >
                    <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
