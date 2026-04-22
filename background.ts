import { Storage } from "@plasmohq/storage"
import { DEFAULT_OPENAI_CONFIG } from "./lib/types"

const storage = new Storage()

chrome.runtime.onInstalled.addListener(async () => {
  const existingConfig = await storage.get("openai-config")
  if (!existingConfig) {
    await storage.set("openai-config", DEFAULT_OPENAI_CONFIG)
  }
})

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await chrome.sidePanel.open({ tabId: tab.id })
  }
})
