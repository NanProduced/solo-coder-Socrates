import type { PlasmoCSConfig } from "plasmo"
import { Readability } from "@mozilla/readability"

export const config: PlasmoCSConfig = {
  matches: ["http://*/*", "https://*/*", "file:///*"],
  run_at: "document_idle",
}

interface ExtractResult {
  success: boolean
  title: string
  content: string
  excerpt: string
  byline: string
  siteName: string
  url: string
  length: number
  isPaywalled: boolean
  isPdfViewer: boolean
  error?: string
}

function isPdfViewerPage(): boolean {
  const embedEl = document.querySelector(
    'embed[type="application/pdf"], object[type="application/pdf"]'
  )
  if (embedEl) return true

  if (document.body && document.body.children.length <= 2) {
    for (const child of document.body.children) {
      if (
        child.tagName === "EMBED" ||
        child.tagName === "OBJECT" ||
        child.tagName === "IFRAME"
      ) {
        const type = child.getAttribute("type") || ""
        const src = (child.getAttribute("src") || "").toLowerCase()
        if (type.includes("pdf") || src.includes(".pdf")) return true
      }
    }
  }

  const url = window.location.href.toLowerCase()
  if (/\/pdf\/./.test(new URL(window.location.href).pathname.toLowerCase())) {
    if (document.querySelectorAll("p").length < 3) return true
  }

  return false
}

function extractWithReadability(): ExtractResult {
  const url = window.location.href

  if (isPdfViewerPage()) {
    return {
      success: false,
      title: document.title || "",
      content: "",
      excerpt: "",
      byline: "",
      siteName: "",
      url,
      length: 0,
      isPaywalled: false,
      isPdfViewer: true,
      error: "PDF_VIEWER_DETECTED",
    }
  }

  try {
    const documentClone = document.cloneNode(true) as Document
    const reader = new Readability(documentClone)
    const article = reader.parse()

    if (article && article.textContent && article.textContent.trim().length > 50) {
      return {
        success: true,
        title: article.title || document.title || "",
        content: article.textContent,
        excerpt: article.excerpt || "",
        byline: article.byline || "",
        siteName: article.siteName || "",
        url,
        length: article.length || article.textContent.length,
        isPaywalled: false,
        isPdfViewer: false,
      }
    }
  } catch (e) {
    console.warn("Readability extraction failed, falling back:", e)
  }

  return extractFallback()
}

function extractFallback(): ExtractResult {
  const url = window.location.href
  const title = document.title || ""

  const mainContent = document.querySelector(
    'main, article, [role="main"], .post-content, .article-content, .entry-content, #content, .content'
  )

  if (mainContent) {
    const content = cleanInnerText(mainContent as HTMLElement)
    if (content.length > 50) {
      return {
        success: true,
        title,
        content,
        excerpt: content.slice(0, 200),
        byline: extractByline(),
        siteName: "",
        url,
        length: content.length,
        isPaywalled: false,
        isPdfViewer: false,
      }
    }
  }

  const paragraphs = document.querySelectorAll("p")
  if (paragraphs.length > 3) {
    const texts: string[] = []
    paragraphs.forEach((p) => {
      const text = (p as HTMLElement).innerText.trim()
      if (text.length > 20) {
        texts.push(text)
      }
    })
    if (texts.length > 0) {
      const content = texts.join("\n\n")
      return {
        success: true,
        title,
        content,
        excerpt: texts[0].slice(0, 200),
        byline: extractByline(),
        siteName: "",
        url,
        length: content.length,
        isPaywalled: false,
        isPdfViewer: false,
      }
    }
  }

  const bodyText = cleanInnerText(document.body)
  return {
    success: bodyText.length > 50,
    title,
    content: bodyText,
    excerpt: bodyText.slice(0, 200),
    byline: "",
    siteName: "",
    url,
    length: bodyText.length,
    isPaywalled: false,
    isPdfViewer: false,
    error: bodyText.length <= 50 ? "PAGE_CONTENT_TOO_SHORT" : undefined,
  }
}

function cleanInnerText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement

  const removeSelectors = [
    "script",
    "style",
    "noscript",
    "nav",
    "header",
    "footer",
    "iframe",
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    ".ad",
    ".ads",
    ".advertisement",
    ".sidebar",
    ".comment",
    ".comments",
    ".social-share",
    ".share-buttons",
    ".related-posts",
    ".newsletter",
    ".popup",
    ".modal",
    ".cookie-banner",
    ".cookie-notice",
  ]

  removeSelectors.forEach((sel) => {
    try {
      clone.querySelectorAll(sel).forEach((node) => node.remove())
    } catch {}
  })

  return clone.innerText || ""
}

function extractByline(): string {
  const bylineSelectors = [
    '[rel="author"]',
    ".byline",
    ".author",
    ".post-author",
    '[itemprop="author"]',
    "meta[name='author']",
  ]

  for (const sel of bylineSelectors) {
    const el = document.querySelector(sel)
    if (el) {
      const text = el.getAttribute("content") || el.textContent || ""
      if (text.trim()) return text.trim()
    }
  }

  return ""
}

function isContextValid(): boolean {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime) return false
    return !!chrome.runtime?.id
  } catch {
    return false
  }
}

function safeSendResponse(
  sendResponse: (response?: any) => void,
  result: ExtractResult
): void {
  try {
    sendResponse(result)
  } catch (e) {
    console.warn("Socrates: Extension context invalidated, cannot send response")
  }
}

chrome.runtime.onMessage.addListener(
  (request: { type: string }, _sender, sendResponse) => {
    if (!isContextValid()) return false

    if (request.type === "EXTRACT_CONTENT") {
      try {
        const result = extractWithReadability()
        safeSendResponse(sendResponse, result)
      } catch (error) {
        safeSendResponse(sendResponse, {
          success: false,
          title: document.title || "",
          content: "",
          excerpt: "",
          byline: "",
          siteName: "",
          url: window.location.href,
          length: 0,
          isPaywalled: false,
          isPdfViewer: false,
          error: error instanceof Error ? error.message : "Unknown error",
        })
      }
      return true
    }
  }
)
