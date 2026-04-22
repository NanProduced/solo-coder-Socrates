import { Storage } from "@plasmohq/storage"
import { DEFAULT_OPENAI_CONFIG } from "./lib/types"

const storage = new Storage()

chrome.runtime.onInstalled.addListener(async () => {
  const existingConfig = await storage.get("openai-config")
  if (!existingConfig) {
    await storage.set("openai-config", DEFAULT_OPENAI_CONFIG)
  }

  // 向所有已打开的标签页注入 Content Script
  try {
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (tab.id && tab.url && (tab.url.startsWith("http") || tab.url.startsWith("file"))) {
        try {
          // 尝试注入 Content Script
          // 注意：Plasmo 会将 contents/ 目录下的文件打包到扩展根目录
          // 我们使用 chrome.scripting.executeScript 来动态注入
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content-extractor.js"]
          })
        } catch (e) {
          // 忽略注入失败的标签页（比如 chrome:// 页面）
          console.log(`Failed to inject content script into tab ${tab.id}:`, e)
        }
      }
    }
  } catch (e) {
    console.error("Failed to inject content scripts on install:", e)
  }
})

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await chrome.sidePanel.open({ tabId: tab.id })
  }
})
