import { smartTruncate, buildContextPrompt, ContentMeta } from "./content-utils"
import { extractPdfFromUrl, extractPdfViaInjection, getCookiesForUrl } from "./pdf-extract"

interface PageContentResult {
  title: string
  content: string
  url: string
  contextPrompt: string
  error?: string
}

function isPdfUrl(url: string): boolean {
  return url.toLowerCase().endsWith(".pdf") || url.toLowerCase().includes(".pdf?")
}

function isFileUrl(url: string): boolean {
  return url.startsWith("file://")
}

async function sendTabMessage(
  tabId: number,
  message: { type: string },
  onContextInvalidated?: () => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Content script timeout"))
    }, 2000)

    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        clearTimeout(timeout)
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message || ""
          if (
            errMsg.includes("Extension context invalidated") ||
            errMsg.includes("message channel is closed")
          ) {
            onContextInvalidated?.()
            reject(new Error("扩展上下文已失效，请刷新页面后重试"))
          } else {
            reject(new Error(errMsg))
          }
        } else {
          resolve(response)
        }
      })
    } catch {
      clearTimeout(timeout)
      onContextInvalidated?.()
      reject(new Error("扩展上下文已失效，请刷新页面后重试"))
    }
  })
}

async function extractWithScriptInjection(
  tabId: number,
  pageUrl: string,
  onContextInvalidated?: () => void,
  skipPdfRedirect: boolean = false
): Promise<PageContentResult> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const embedEl = document.querySelector(
          'embed[type="application/pdf"], object[type="application/pdf"]'
        )
        if (embedEl) {
          return { isPdfViewer: true, title: document.title || "", content: "", url: window.location.href }
        }

        const title = document.title || ""
        let content = ""

        const removeSelectors = [
          "script", "style", "noscript", "nav", "header", "footer", "iframe",
          '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
          ".ad", ".ads", ".sidebar", ".comment", ".social-share", ".cookie-banner",
        ]

        const mainContent = document.querySelector(
          'main, article, [role="main"], .post-content, .article-content, .entry-content, #content'
        )

        const source = mainContent || document.body
        const clone = source.cloneNode(true) as HTMLElement

        removeSelectors.forEach((sel) => {
          try {
            clone.querySelectorAll(sel).forEach((node) => node.remove())
          } catch {}
        })

        content = clone.innerText || document.body.innerText

        return { isPdfViewer: false, title, content, url: window.location.href }
      },
    })

    if (results && results[0]?.result) {
      const result = results[0].result as {
        isPdfViewer: boolean
        title: string
        content: string
        url: string
      }

      if (result.isPdfViewer && !skipPdfRedirect) {
        return await extractOnlinePdfContent(tabId, pageUrl, onContextInvalidated)
      }

      if (result.isPdfViewer && skipPdfRedirect) {
        return {
          title: result.title,
          content: "",
          url: result.url,
          contextPrompt: "",
          error: "PDF 内容提取失败，无法读取该 PDF 文件。",
        }
      }

      if (result.content && result.content.length > 50) {
        const meta: ContentMeta = {
          title: result.title,
          excerpt: result.content.slice(0, 200),
          byline: "",
          siteName: "",
          url: pageUrl,
        }
        const truncatedContent = smartTruncate(result.content, meta)
        const contextPrompt = buildContextPrompt(meta, truncatedContent)

        return {
          title: result.title,
          content: result.content,
          url: result.url,
          contextPrompt,
        }
      }

      return {
        title: result.title,
        content: "",
        url: result.url,
        contextPrompt: "",
        error: "页面内容过少，无法提取有效信息。请确认页面已完全加载。",
      }
    }
  } catch (error) {
    console.error("Script injection fallback failed:", error)
  }
  return { title: "", content: "", url: "", contextPrompt: "", error: "无法提取页面内容，可能是浏览器限制页面" }
}

async function extractOnlinePdfContent(
  tabId: number,
  url: string,
  onContextInvalidated?: () => void
): Promise<PageContentResult> {
  try {
    const cookies = await getCookiesForUrl(url)
    const result = await extractPdfFromUrl(url, cookies || undefined)

    if (result.success && result.content) {
      const meta: ContentMeta = {
        title: result.title,
        excerpt: result.content.slice(0, 200),
        byline: "",
        siteName: "",
        url,
      }
      const truncatedContent = smartTruncate(result.content, meta)
      const contextPrompt = buildContextPrompt(meta, truncatedContent)

      return { title: result.title, content: result.content, url, contextPrompt }
    }

    return await extractPdfViaInjectionFallback(tabId, url, onContextInvalidated, result.error)
  } catch (error) {
    return await extractPdfViaInjectionFallback(tabId, url, onContextInvalidated, error instanceof Error ? error.message : "PDF 提取失败")
  }
}

async function extractPdfViaInjectionFallback(
  tabId: number,
  url: string,
  onContextInvalidated?: () => void,
  previousError?: string
): Promise<PageContentResult> {
  try {
    const result = await extractPdfViaInjection(tabId, url)

    if (result.success && result.content) {
      const meta: ContentMeta = {
        title: result.title,
        excerpt: result.content.slice(0, 200),
        byline: "",
        siteName: "",
        url,
      }
      const truncatedContent = smartTruncate(result.content, meta)
      const contextPrompt = buildContextPrompt(meta, truncatedContent)

      return { title: result.title, content: result.content, url, contextPrompt }
    }

    return {
      title: "",
      content: "",
      url,
      contextPrompt: "",
      error: `PDF 内容提取失败：${result.error || previousError || "未知错误"}`,
    }
  } catch {
    return {
      title: "",
      content: "",
      url,
      contextPrompt: "",
      error: `PDF 内容提取失败：${previousError || "未知错误"}`,
    }
  }
}

async function extractLocalPdfContent(
  tabId: number,
  url: string
): Promise<PageContentResult> {
  try {
    const result = await extractPdfViaInjection(tabId, url)

    if (result.success && result.content) {
      const meta: ContentMeta = {
        title: result.title,
        excerpt: result.content.slice(0, 200),
        byline: "",
        siteName: "",
        url,
      }
      const truncatedContent = smartTruncate(result.content, meta)
      const contextPrompt = buildContextPrompt(meta, truncatedContent)

      return { title: result.title, content: result.content, url, contextPrompt }
    }
  } catch (error) {
    console.error("Local PDF extraction failed:", error)
  }
  return { title: "", content: "", url: "", contextPrompt: "", error: "本地 PDF 提取失败，请确认已开启文件访问权限" }
}

async function extractWebContent(
  tabId: number,
  pageUrl: string,
  onContextInvalidated?: () => void
): Promise<PageContentResult> {
  try {
    const response = await sendTabMessage(tabId, { type: "EXTRACT_CONTENT" }, onContextInvalidated)

    if (response?.isPdfViewer) {
      return await extractOnlinePdfContent(tabId, pageUrl, onContextInvalidated)
    }

    if (response?.success && response.content) {
      const meta: ContentMeta = {
        title: response.title || "",
        excerpt: response.excerpt || "",
        byline: response.byline || "",
        siteName: response.siteName || "",
        url: pageUrl,
      }
      const truncatedContent = smartTruncate(response.content, meta)
      const contextPrompt = buildContextPrompt(meta, truncatedContent)

      return { title: meta.title, content: response.content, url: pageUrl, contextPrompt }
    }

    if (response?.error === "PAGE_CONTENT_TOO_SHORT") {
      return {
        title: response.title || "",
        content: "",
        url: pageUrl,
        contextPrompt: "",
        error: "页面内容过少，无法提取有效信息。请确认页面已完全加载。",
      }
    }

    if (response && !response.success) {
      return {
        title: response.title || "",
        content: "",
        url: pageUrl,
        contextPrompt: "",
        error: "页面内容提取失败，请确认页面已完全加载后重试。",
      }
    }
  } catch (error) {
    console.warn("Content script not available, falling back to executeScript:", error)
  }

  return await extractWithScriptInjection(tabId, pageUrl, onContextInvalidated)
}

export async function getPageContent(
  onContextInvalidated?: () => void
): Promise<PageContentResult> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !tab.url) {
      return { title: "", content: "", url: "", contextPrompt: "", error: "无法获取当前标签页信息" }
    }

    const pageUrl = tab.url

    if (isPdfUrl(pageUrl)) {
      if (isFileUrl(pageUrl)) {
        return await extractLocalPdfContent(tab.id, pageUrl)
      }
      return await extractOnlinePdfContent(tab.id, pageUrl, onContextInvalidated)
    }

    return await extractWebContent(tab.id, pageUrl, onContextInvalidated)
  } catch (error) {
    console.error("Failed to get page content:", error)
    return { title: "", content: "", url: "", contextPrompt: "", error: "页面内容提取失败" }
  }
}
