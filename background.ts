import { Storage } from "@plasmohq/storage"

const storage = new Storage()

chrome.runtime.onInstalled.addListener(async () => {
  const existingConfig = await storage.get("openai-config")
  if (!existingConfig) {
    await storage.set("openai-config", {
      baseURL: "",
      apiKey: "",
      model: "gpt-4o"
    })
  }
})

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await chrome.sidePanel.open({ tabId: tab.id })
  }
})
