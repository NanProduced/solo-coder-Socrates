import { useState, useEffect } from "react"
import { useStorage } from "@plasmohq/storage/hook"

interface OpenAIConfig {
  baseURL: string
  apiKey: string
  model: string
}

function OptionsPage() {
  const [config, setConfig] = useStorage<OpenAIConfig>("openai-config", {
    baseURL: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o"
  })

  const [baseURL, setBaseURL] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState("")
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (config) {
      setBaseURL(config.baseURL || "")
      setApiKey(config.apiKey || "")
      setModel(config.model || "")
    }
  }, [config])

  const handleSave = () => {
    setConfig({
      baseURL: baseURL.trim(),
      apiKey: apiKey.trim(),
      model: model.trim()
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="min-h-screen bg-notion-bg-secondary py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-notion-bg rounded-lg shadow-notion p-6 mb-6">
          <h1 className="text-2xl font-semibold text-notion-text mb-1">
            苏格拉底式阅读助手
          </h1>
          <p className="text-notion-text-secondary text-sm">
            配置 AI 服务参数，开始你的深度阅读之旅
          </p>
        </div>

        <div className="bg-notion-bg rounded-lg shadow-notion p-6">
          <h2 className="text-lg font-medium text-notion-text mb-4">
            OpenAI 兼容服务配置
          </h2>

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-notion-text mb-2">
                API 地址 (Base URL)
              </label>
              <input
                type="text"
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full px-3 py-2 border border-notion-border rounded-md text-notion-text focus:outline-none focus:ring-2 focus:ring-notion-accent focus:border-transparent transition-all"
              />
              <p className="mt-1 text-xs text-notion-text-secondary">
                支持 OpenAI 兼容的服务地址，如 OpenRouter、Together.ai 等
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-notion-text mb-2">
                API 密钥 (API Key)
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-xxxxxxxxxxxxxxxx"
                className="w-full px-3 py-2 border border-notion-border rounded-md text-notion-text focus:outline-none focus:ring-2 focus:ring-notion-accent focus:border-transparent transition-all"
              />
              <p className="mt-1 text-xs text-notion-text-secondary">
                你的 API 密钥仅保存在本地浏览器中
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-notion-text mb-2">
                模型名称 (Model)
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="gpt-4o"
                className="w-full px-3 py-2 border border-notion-border rounded-md text-notion-text focus:outline-none focus:ring-2 focus:ring-notion-accent focus:border-transparent transition-all"
              />
              <p className="mt-1 text-xs text-notion-text-secondary">
                例如: gpt-4o, gpt-3.5-turbo, claude-3-opus (取决于你的服务提供商)
              </p>
            </div>

            <div className="pt-2">
              <button
                onClick={handleSave}
                className={`px-4 py-2 rounded-md font-medium transition-all ${
                  saved
                    ? "bg-green-500 text-white"
                    : "bg-notion-accent text-white hover:bg-notion-accent-hover"
                }`}
              >
                {saved ? "✓ 已保存" : "保存配置"}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-notion-text-secondary">
          <p>提示: 配置完成后，点击浏览器工具栏中的插件图标开始使用</p>
        </div>
      </div>
    </div>
  )
}

export default OptionsPage
