import { DocumentSection } from "../lib/content-utils"

interface SectionPickerProps {
  sections: DocumentSection[]
  onSelect: (section: DocumentSection | null) => void
  onCancel: () => void
}

export const SectionPicker = ({
  sections,
  onSelect,
  onCancel,
}: SectionPickerProps) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-full px-6 py-8 text-center">
      <div className="w-14 h-14 bg-notion-bg-secondary rounded-2xl flex items-center justify-center mb-4 border border-notion-border/50">
        <svg className="w-7 h-7 text-notion-accent/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h10M4 18h7" />
        </svg>
      </div>
      <h2 className="text-base font-bold mb-1">文档较长</h2>
      <p className="text-xs text-notion-text-secondary mb-5 leading-relaxed">
        检测到 {sections.length} 个章节，可选择聚焦某个章节，或阅读全文
      </p>

      <div className="w-full max-w-xs space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin">
        {sections.map((section) => (
          <button
            key={section.index}
            onClick={() => onSelect(section)}
            className="w-full text-left px-3 py-2.5 bg-notion-bg-secondary rounded-xl border border-notion-border/30 hover:border-notion-accent/30 hover:bg-notion-hover transition-all group"
          >
            <div className="flex items-center gap-2">
              <div
                className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                style={{
                  backgroundColor: section.level === 1
                    ? "rgba(59,130,246,0.1)"
                    : section.level === 2
                    ? "rgba(139,92,246,0.1)"
                    : "rgba(107,114,128,0.1)",
                }}
              >
                <span className="text-[10px] font-bold text-notion-accent">
                  {section.index + 1}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate group-hover:text-notion-accent transition-colors">
                  {section.title}
                </div>
                <div className="text-[10px] text-notion-text-secondary">
                  {section.charCount > 1000
                    ? `${Math.round(section.charCount / 1000)}k 字符`
                    : `${section.charCount} 字符`}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-4 w-full max-w-xs space-y-2">
        <button
          onClick={() => onSelect(null)}
          className="w-full px-4 py-2.5 bg-notion-accent text-white rounded-xl font-bold shadow-lg shadow-notion-accent/20 hover:bg-notion-accent-hover transition-all active:scale-95"
        >
          阅读全文
        </button>
        <button
          onClick={onCancel}
          className="w-full px-4 py-2 text-notion-text-secondary text-xs hover:text-notion-text transition-colors"
        >
          取消
        </button>
      </div>
    </div>
  )
}
