import { useState, useEffect } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import { OpenAIConfig, DEFAULT_OPENAI_CONFIG } from "./lib/types"
import "./style.css"

function OptionsPage() {
  const [config, setConfig] = useStorage<OpenAIConfig>("openai-config", DEFAULT_OPENAI_CONFIG)

  const [baseURL, setBaseURL] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState("")
  const [saved, setSaved] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (config) {
      setBaseURL(config.baseURL || "")
      setApiKey(config.apiKey || "")
      setModel(config.model || "")
    }
  }, [config])

  const handleSave = () => {
    setValidationError(null)
    const trimmedBaseURL = baseURL.trim()
    const trimmedApiKey = apiKey.trim()
    const trimmedModel = model.trim()

    if (!trimmedBaseURL) { setValidationError("请填写 API 地址"); return }
    try { new URL(trimmedBaseURL) } catch { setValidationError("API 地址格式不正确"); return }
    if (!trimmedApiKey) { setValidationError("请填写 API 密钥"); return }
    if (!trimmedModel) { setValidationError("请填写模型名称"); return }

    setConfig({ baseURL: trimmedBaseURL, apiKey: trimmedApiKey, model: trimmedModel })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="flex min-h-screen bg-notion-bg text-notion-text transition-colors duration-300">
      {/* 左侧装饰性侧边栏 */}
      <aside className="w-64 border-r border-notion-border bg-notion-bg-secondary flex flex-col p-6 hidden md:flex">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-8 h-8 bg-notion-accent rounded-lg flex items-center justify-center shadow-sm">
             <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5h8M9 5v14m6-14v14M6 19h12" />
             </svg>
          </div>
          <span className="font-bold text-sm tracking-tight">苏格拉底控制台</span>
        </div>

        <nav className="flex-1 space-y-1">
          <button className="w-full flex items-center gap-3 px-3 py-2 bg-notion-hover rounded-lg text-sm font-medium text-notion-text transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            AI 核心配置
          </button>
        </nav>

        <div className="mt-auto pt-6 border-t border-notion-border">
          <p className="text-[11px] text-notion-text-secondary font-medium text-center italic opacity-60">Wisdom through inquiry</p>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 p-8 md:p-16 max-w-4xl overflow-y-auto relative">
        {/* 背景希腊石柱装饰 - 极简极淡 */}
        <div className="absolute top-0 right-0 opacity-[0.03] pointer-events-none select-none dark:opacity-[0.05]">
           <svg width="400" height="600" viewBox="0 0 400 600" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M100 50H300M120 50V550M280 50V550M150 50V550M180 50V550M220 50V550M250 50V550" stroke="currentColor" strokeWidth="2" />
              <rect x="80" y="550" width="240" height="20" fill="currentColor" />
           </svg>
        </div>

        <div className="relative z-10">
          <header className="mb-12">
            <h1 className="text-3xl font-bold tracking-tight mb-2">模型配置</h1>
            <p className="text-notion-text-secondary">连接你的 AI 大脑，为导师苏格拉底注入生命力。</p>
          </header>

          <section className="space-y-8 max-w-xl">
            {/* 配置项卡片 */}
            <div className="space-y-6">
              <div className="group">
                <label className="block text-xs font-bold text-notion-text-secondary mb-2 group-focus-within:text-notion-accent transition-colors">
                  API 访问地址
                </label>
                <input
                  type="text"
                  value={baseURL}
                  onChange={(e) => { setBaseURL(e.target.value); setValidationError(null) }}
                  placeholder="https://api.openai.com/v1"
                  className="w-full bg-notion-bg-secondary px-4 py-3 border border-notion-border rounded-xl text-notion-text focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent transition-all placeholder:opacity-30"
                />
              </div>

              <div className="group">
                <label className="block text-xs font-bold text-notion-text-secondary mb-2 group-focus-within:text-notion-accent transition-colors">
                  API 模型密钥
                </label>
                <div className="relative">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => { setApiKey(e.target.value); setValidationError(null) }}
                    placeholder="sk-••••••••••••••••"
                    className="w-full bg-notion-bg-secondary px-4 py-3 border border-notion-border rounded-xl text-notion-text focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent transition-all placeholder:opacity-30 font-mono"
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] text-notion-text-secondary font-medium bg-notion-bg px-2 py-0.5 rounded border border-notion-border">
                    Local storage only
                  </div>
                </div>
              </div>

              <div className="group">
                <label className="block text-xs font-bold text-notion-text-secondary mb-2 group-focus-within:text-notion-accent transition-colors">
                  默认模型名称
                </label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => { setModel(e.target.value); setModel(e.target.value); setValidationError(null) }}
                  placeholder="gpt-4o"
                  className="w-full bg-notion-bg-secondary px-4 py-3 border border-notion-border rounded-xl text-notion-text focus:outline-none focus:ring-2 focus:ring-notion-accent/20 focus:border-notion-accent transition-all placeholder:opacity-30"
                />
              </div>
            </div>

            {validationError && (
              <div className="flex items-center gap-2 px-4 py-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm animate-shake">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {validationError}
              </div>
            )}

            <div className="pt-4 flex items-center gap-4">
              <button
                onClick={handleSave}
                disabled={saved}
                className={`relative px-8 py-3 rounded-xl font-bold transition-all overflow-hidden ${
                  saved
                    ? "bg-green-500 text-white"
                    : "bg-notion-accent text-white hover:bg-notion-accent-hover shadow-lg shadow-notion-accent/20 active:scale-95"
                }`}
              >
                <span className={`flex items-center gap-2 transition-transform duration-300 ${saved ? '-translate-y-10' : 'translate-y-0'}`}>
                  保存配置
                </span>
                <span className={`absolute inset-0 flex items-center justify-center gap-2 transition-transform duration-300 ${saved ? 'translate-y-0' : 'translate-y-10'}`}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  智慧已连接
                </span>
              </button>
            </div>
          </section>

          <footer className="mt-20 pt-8 border-t border-notion-border/50 text-xs text-notion-text-secondary flex flex-col gap-2">
            <p>· 你的 API 密钥将通过 chrome.storage.local 加密存储，绝不会上传至第三方服务器。</p>
            <p>· 建议使用支持长上下文的模型以获得最佳的阅读理解体验。</p>
          </footer>
        </div>
      </main>
    </div>
  )
}

export default OptionsPage
