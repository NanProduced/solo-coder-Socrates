import { useState, useEffect } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import { OpenAIConfig, DEFAULT_OPENAI_CONFIG } from "./lib/types"
import "./style.css"

function IndexPopup() {
  const [config] = useStorage<OpenAIConfig>("openai-config", DEFAULT_OPENAI_CONFIG)
  const [hasConfig, setHasConfig] = useState(false)
  const [pageStatus, setPageStatus] = useState<"analyzing" | "ready" | "unsupported">("analyzing")

  useEffect(() => {
    if (config) {
      setHasConfig(!!config.apiKey && !!config.baseURL)
    }
  }, [config])

  useEffect(() => {
    // 快速检测页面是否可读
    const checkPage = async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab?.url?.startsWith("http")) {
          setPageStatus("ready")
        } else {
          setPageStatus("unsupported")
        }
      } catch {
        setPageStatus("unsupported")
      }
    }
    checkPage()
  }, [])

  const openSidePanel = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab.id) {
      await chrome.sidePanel.open({ tabId: tab.id })
    }
  }

  const openOptions = () => {
    chrome.runtime.openOptionsPage()
  }

  return (
    <div className="w-80 bg-notion-bg p-5 transition-colors duration-300">
      <div className="flex items-center gap-4 mb-6">
        {/* 古典风格图标容器 */}
        <div className="relative w-12 h-12 bg-notion-bg-secondary rounded-xl flex items-center justify-center border border-notion-border shadow-sm">
          <svg className="w-7 h-7 text-notion-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
             {/* 极简希腊柱体/智慧象征 */}
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 5h8M9 5v14m6-14v14M6 19h12M7 5a1 1 0 011-1h8a1 1 0 011 1v0a1 1 0 01-1 1H8a1 1 0 01-1-1v0z" />
          </svg>
          <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-white dark:bg-notion-bg rounded-full border border-notion-border flex items-center justify-center">
            <div className={`w-2 h-2 rounded-full ${pageStatus === 'ready' ? 'bg-green-500' : 'bg-notion-text-secondary opacity-50'}`} />
          </div>
        </div>
        <div>
          <h1 className="text-[17px] font-bold text-notion-text tracking-tight">苏格拉底</h1>
          <p className="text-[10px] uppercase tracking-[0.2em] text-notion-text-secondary font-semibold">思辨阅读 · 智识启发</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="px-4 py-3 bg-notion-bg-secondary rounded-xl border border-notion-border/50">
          {pageStatus === "ready" ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-notion-text font-medium">页面已就绪，导师已入座。</span>
            </div>
          ) : pageStatus === "unsupported" ? (
            <span className="text-xs text-notion-text-secondary italic">此页面不支持深度阅读模式。</span>
          ) : (
            <span className="text-xs text-notion-text-secondary animate-pulse">正在感应页面内容...</span>
          )}
        </div>

        <div className="pt-2">
          {hasConfig ? (
            <div className="space-y-2">
              <button
                onClick={openSidePanel}
                className="w-full px-4 py-3 bg-notion-accent text-white rounded-xl font-bold shadow-md shadow-notion-accent/20 hover:bg-notion-accent-hover transition-all active:scale-[0.98]"
              >
                开启智慧对话
              </button>
              <button
                onClick={openOptions}
                className="w-full px-4 py-2.5 text-notion-text-secondary text-[13px] font-medium hover:bg-notion-hover rounded-lg transition-colors border border-transparent hover:border-notion-border"
              >
                偏好设置
              </button>
            </div>
          ) : (
            <button
              onClick={openOptions}
              className="w-full px-4 py-3 bg-notion-accent text-white rounded-xl font-bold shadow-md shadow-notion-accent/20 hover:bg-notion-accent-hover transition-all active:scale-[0.98]"
            >
              配置 AI 模型密钥
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default IndexPopup
