import { useState, useEffect } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import { OpenAIConfig, DEFAULT_OPENAI_CONFIG } from "./lib/types"
import "./style.css"

function IndexPopup() {
  const [config] = useStorage<OpenAIConfig>("openai-config", DEFAULT_OPENAI_CONFIG)

  const [hasConfig, setHasConfig] = useState(false)

  useEffect(() => {
    if (config) {
      setHasConfig(!!config.apiKey && !!config.baseURL)
    }
  }, [config])

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
    <div className="w-72 bg-notion-bg p-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-notion-accent rounded-lg flex items-center justify-center">
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-notion-text">苏格拉底</h1>
          <p className="text-xs text-notion-text-secondary">阅读助手</p>
        </div>
      </div>

      <div className="space-y-2">
        {hasConfig ? (
          <>
            <p className="text-sm text-notion-text-secondary mb-3">
              打开侧边栏，开始苏格拉底式深度阅读
            </p>
            <button
              onClick={openSidePanel}
              className="w-full px-4 py-2.5 bg-notion-accent text-white rounded-md font-medium hover:bg-notion-accent-hover transition-colors"
            >
              打开侧边栏
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-notion-text-secondary mb-3">
              请先配置 AI 服务参数
            </p>
            <button
              onClick={openOptions}
              className="w-full px-4 py-2.5 bg-notion-accent text-white rounded-md font-medium hover:bg-notion-accent-hover transition-colors"
            >
              配置参数
            </button>
          </>
        )}

        <button
          onClick={openOptions}
          className="w-full px-4 py-2 text-notion-text-secondary text-sm hover:bg-notion-hover rounded-md transition-colors"
        >
          设置
        </button>
      </div>
    </div>
  )
}

export default IndexPopup
