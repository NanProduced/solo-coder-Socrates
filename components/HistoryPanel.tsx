import { useState } from "react"
import { ConversationRound } from "../lib/types"
import { formatTime, formatDateGroup, extractHostname } from "../lib/utils"

interface HistoryPanelProps {
  allHistoryRounds: ConversationRound[]
  editMode: boolean
  selectedIds: Set<string>
  deletingId: string | null
  confirmClearAll: boolean
  onOpenRound: (round: ConversationRound) => void
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  onDeleteSelected: () => void
  onDeleteSingle: (id: string) => void
  onClearAll: () => void
  onSetEditMode: (mode: boolean) => void
  onSetDeletingId: (id: string | null) => void
  onSetConfirmClearAll: (confirm: boolean) => void
  onClose: () => void
}

export const HistoryPanel = ({
  allHistoryRounds,
  editMode,
  selectedIds,
  deletingId,
  confirmClearAll,
  onOpenRound,
  onToggleSelect,
  onToggleSelectAll,
  onDeleteSelected,
  onDeleteSingle,
  onClearAll,
  onSetEditMode,
  onSetDeletingId,
  onSetConfirmClearAll,
  onClose,
}: HistoryPanelProps) => {
  const groupedHistory = (() => {
    const groups: { label: string; rounds: ConversationRound[] }[] = []
    const groupMap = new Map<string, ConversationRound[]>()

    for (const round of allHistoryRounds) {
      const label = formatDateGroup(round.updatedAt)
      if (!groupMap.has(label)) groupMap.set(label, [])
      groupMap.get(label)!.push(round)
    }

    const order = ["今天", "昨天", "最近七天", "最近三十天", "更早"]
    for (const label of order) {
      if (groupMap.has(label)) groups.push({ label, rounds: groupMap.get(label)! })
    }

    return groups
  })()

  const exitEditMode = () => {
    onSetEditMode(false)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-notion-bg border-b border-notion-border">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold">历史对话</h2>
            {allHistoryRounds.length > 0 && !editMode && (
              <button
                onClick={() => onSetEditMode(true)}
                className="text-[11px] text-notion-accent hover:text-notion-accent-hover font-medium transition-colors"
              >
                管理
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            {editMode ? (
              <>
                <button
                  onClick={onToggleSelectAll}
                  className="text-[11px] text-notion-accent hover:text-notion-accent-hover font-medium px-2 py-1 transition-colors"
                >
                  {selectedIds.size === allHistoryRounds.length ? "取消全选" : "全选"}
                </button>
                <button
                  onClick={exitEditMode}
                  className="text-[11px] text-notion-text-secondary hover:text-notion-text font-medium px-2 py-1 transition-colors"
                >
                  完成
                </button>
              </>
            ) : (
              <button
                onClick={onClose}
                className="p-1 text-notion-text-secondary hover:bg-notion-hover rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {editMode && selectedIds.size > 0 && (
          <div className="px-4 pb-2 flex items-center gap-2">
            <button
              onClick={onDeleteSelected}
              className="text-[11px] font-medium px-3 py-1.5 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500/20 transition-colors"
            >
              删除所选 ({selectedIds.size})
            </button>
          </div>
        )}

        {editMode && !confirmClearAll && (
          <div className="px-4 pb-2">
            <button
              onClick={() => onSetConfirmClearAll(true)}
              className="text-[11px] text-notion-text-secondary hover:text-red-500 transition-colors"
            >
              清空全部对话
            </button>
          </div>
        )}

        {editMode && confirmClearAll && (
          <div className="px-4 pb-2 flex items-center gap-2">
            <span className="text-[11px] text-red-500">确认清空所有对话？</span>
            <button
              onClick={onClearAll}
              className="text-[11px] font-medium px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
            >
              清空
            </button>
            <button
              onClick={() => onSetConfirmClearAll(false)}
              className="text-[11px] text-notion-text-secondary hover:text-notion-text px-2 py-1 transition-colors"
            >
              取消
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {allHistoryRounds.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
            <svg className="w-12 h-12 text-notion-border mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-notion-text-secondary">暂无历史对话</p>
            <p className="text-xs text-notion-text-secondary mt-1 opacity-60">开始阅读引导后，对话会自动保存在这里</p>
          </div>
        ) : (
          <div className="p-3">
            {groupedHistory.map((group) => (
              <div key={group.label} className="mb-4">
                <div className="px-2 py-1.5 mb-1">
                  <span className="text-[11px] font-semibold text-notion-text-secondary uppercase tracking-wider">
                    {group.label}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {group.rounds.map((round) => (
                    <div
                      key={round.id}
                      className={`relative rounded-lg transition-colors ${
                        editMode
                          ? selectedIds.has(round.id)
                            ? "bg-notion-accent/5"
                            : "hover:bg-notion-hover/50"
                          : ""
                      }`}
                    >
                      <button
                        onClick={() => {
                          if (editMode) {
                            onToggleSelect(round.id)
                          } else {
                            onOpenRound(round)
                          }
                        }}
                        className="w-full px-3 py-2.5 rounded-lg transition-colors text-left hover:bg-notion-hover group"
                      >
                        <div className="flex items-start gap-2.5">
                          {editMode && (
                            <div
                              className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center mt-1 transition-colors ${
                                selectedIds.has(round.id)
                                  ? "bg-notion-accent"
                                  : "bg-notion-bg-secondary border border-notion-border"
                              }`}
                            >
                              {selectedIds.has(round.id) && (
                                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                          )}
                          <div className="w-7 h-7 bg-notion-bg-secondary rounded-lg flex-shrink-0 flex items-center justify-center border border-notion-border/50 mt-0.5">
                            <svg className="w-3.5 h-3.5 text-notion-accent/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium truncate">
                                {round.pageTitle || "未命名页面"}
                              </span>
                              {round.completed ? (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400 flex-shrink-0">
                                  已完成
                                </span>
                              ) : (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-notion-accent/10 text-notion-accent flex-shrink-0">
                                  进行中
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-notion-text-secondary truncate">
                                {extractHostname(round.pageUrl)}
                              </span>
                              <span className="text-[10px] text-notion-text-secondary opacity-40">·</span>
                              <span className="text-[10px] text-notion-text-secondary flex-shrink-0">
                                {formatTime(round.updatedAt)}
                              </span>
                            </div>
                          </div>
                          {!editMode && deletingId !== round.id && (
                            <svg className="w-4 h-4 text-notion-text-secondary opacity-0 group-hover:opacity-50 flex-shrink-0 mt-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                        </div>
                      </button>

                      {!editMode && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                          {deletingId === round.id ? (
                            <div className="flex items-center gap-1 bg-notion-bg rounded-lg shadow-sm border border-notion-border px-1.5 py-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onDeleteSingle(round.id)
                                }}
                                className="text-[10px] font-medium text-red-500 hover:text-red-600 px-1.5 py-0.5 transition-colors"
                              >
                                删除
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onSetDeletingId(null)
                                }}
                                className="text-[10px] text-notion-text-secondary hover:text-notion-text px-1.5 py-0.5 transition-colors"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                onSetDeletingId(round.id)
                              }}
                              className="p-1 text-notion-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                              title="删除"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
