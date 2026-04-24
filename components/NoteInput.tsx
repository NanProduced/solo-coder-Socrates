import { useState, useRef, useEffect } from "react"
import { Note } from "../lib/types"

interface NoteInputProps {
  conceptName?: string
  existingNote?: Note
  onSave: (content: string) => void
  onCancel: () => void
}

export const NoteInput = ({
  conceptName,
  existingNote,
  onSave,
  onCancel,
}: NoteInputProps) => {
  const [content, setContent] = useState(existingNote?.content ?? "")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleSave = () => {
    const trimmed = content.trim()
    if (trimmed) {
      onSave(trimmed)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSave()
    }
    if (e.key === "Escape") {
      onCancel()
    }
  }

  return (
    <div className="mt-2 pl-7">
      {conceptName && (
        <div className="text-[10px] text-notion-accent font-medium mb-1">
          📝 笔记 · {conceptName}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="写下你的理解、疑问或联想..."
        rows={3}
        className="w-full text-xs bg-notion-bg rounded-lg border border-notion-accent/30 focus:border-notion-accent/60 focus:ring-2 focus:ring-notion-accent/10 p-2.5 resize-none min-h-[60px] max-h-40 transition-colors placeholder:text-notion-text-secondary/40"
      />
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-notion-text-secondary opacity-50">
          Ctrl+Enter 保存 · Esc 取消
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onCancel}
            className="text-[11px] px-2.5 py-1 text-notion-text-secondary hover:text-notion-text rounded-lg hover:bg-notion-hover transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!content.trim()}
            className="text-[11px] px-3 py-1 bg-notion-accent text-white rounded-lg hover:bg-notion-accent-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {existingNote ? "更新" : "保存"}
          </button>
        </div>
      </div>
    </div>
  )
}

interface NoteItemProps {
  note: Note
  onEdit: (note: Note) => void
  onDelete: (noteId: string) => void
}

export const NoteItem = ({ note, onEdit, onDelete }: NoteItemProps) => {
  const [confirmDelete, setConfirmDelete] = useState(false)

  const formatNoteTime = (timestamp: number): string => {
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
    return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })
  }

  return (
    <div className="group relative pl-7">
      <div className="text-xs text-notion-text leading-relaxed whitespace-pre-wrap break-words">
        {note.content}
      </div>
      <div className="flex items-center gap-2 mt-1">
        {note.conceptName && (
          <span className="text-[10px] px-1.5 py-0.5 bg-notion-accent/10 text-notion-accent rounded-full">
            {note.conceptName}
          </span>
        )}
        <span className="text-[10px] text-notion-text-secondary opacity-50">
          {formatNoteTime(note.updatedAt)}
        </span>
        <div className="flex items-center gap-1 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onEdit(note)}
            className="text-[10px] text-notion-text-secondary hover:text-notion-accent px-1 transition-colors"
          >
            编辑
          </button>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-[10px] text-notion-text-secondary hover:text-red-500 px-1 transition-colors"
            >
              删除
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => onDelete(note.id)}
                className="text-[10px] text-red-500 font-medium px-1"
              >
                确认
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-[10px] text-notion-text-secondary px-1"
              >
                取消
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
