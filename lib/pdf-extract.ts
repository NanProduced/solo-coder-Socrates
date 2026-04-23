import * as pdfjsLib from "pdfjs-dist"
import type { TextItem } from "pdfjs-dist/types/src/display/api"

try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("assets/pdf.worker.min.js")
} catch {
  pdfjsLib.GlobalWorkerOptions.workerSrc = ""
}

export interface PdfExtractResult {
  success: boolean
  title: string
  content: string
  pageCount: number
  error?: string
}

export function isFileUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "file:"
  } catch {
    return url.startsWith("file://")
  }
}

export function isPdfUrl(url: string): boolean {
  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname.toLowerCase()
    if (pathname.endsWith(".pdf")) return true
    if (/\/pdf\/./.test(pathname)) return true
    if (pathname.endsWith("/pdf")) return true
    const fullUrl = url.toLowerCase()
    if (fullUrl.includes(".pdf?") || fullUrl.includes(".pdf#")) return true
    return false
  } catch {
    return url.toLowerCase().includes(".pdf")
  }
}

export async function extractPdfFromUrl(
  url: string,
  cookies?: string
): Promise<PdfExtractResult> {
  try {
    const headers: Record<string, string> = {}
    if (cookies) {
      headers["Cookie"] = cookies
    }

    const response = await fetch(url, {
      headers,
      credentials: cookies ? undefined : "include",
    })

    if (!response.ok) {
      return {
        success: false,
        title: "",
        content: "",
        pageCount: 0,
        error: `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const arrayBuffer = await response.arrayBuffer()
    const data = new Uint8Array(arrayBuffer)

    return await extractPdfFromData(data, url)
  } catch (error) {
    return {
      success: false,
      title: "",
      content: "",
      pageCount: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

export async function extractPdfFromData(
  data: Uint8Array,
  sourceUrl?: string
): Promise<PdfExtractResult> {
  try {
    const pdf = await pdfjsLib.getDocument({ data }).promise
    const pageCount = pdf.numPages
    const textParts: string[] = []

    let title = ""

    const metadata = await pdf.getMetadata().catch(() => null)
    if (metadata?.info) {
      const info = metadata.info as Record<string, unknown>
      title = (info.Title as string) || ""
    }

    if (!title && sourceUrl) {
      try {
        const urlObj = new URL(sourceUrl)
        const pathname = urlObj.pathname
        const filename = pathname.split("/").pop() || ""
        title = decodeURIComponent(filename.replace(/\.pdf$/i, "")) || ""
      } catch {}
    }

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      const pageText = textContent.items
        .filter((item): item is TextItem => "str" in item)
        .map((item) => item.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()

      if (pageText) {
        textParts.push(pageText)
      }
    }

    const content = textParts.join("\n\n")

    return {
      success: true,
      title: title || "PDF Document",
      content,
      pageCount,
    }
  } catch (error) {
    return {
      success: false,
      title: "",
      content: "",
      pageCount: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

export async function getCookiesForUrl(url: string): Promise<string> {
  if (isFileUrl(url)) return ""

  try {
    const urlObj = new URL(url)
    const cookies = await chrome.cookies.getAll({ domain: urlObj.hostname })
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ")
  } catch {
    return ""
  }
}

export async function checkFileSchemeAccess(): Promise<boolean> {
  try {
    return await chrome.extension.isAllowedFileSchemeAccess()
  } catch {
    return false
  }
}

export async function extractPdfViaInjection(
  tabId: number,
  fileUrl?: string
): Promise<PdfExtractResult> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (url: string | undefined) => {
        const targetUrl = url || window.location.href
        return new Promise<{ success: boolean; data: string; error?: string }>(
          (resolve) => {
            fetch(targetUrl, { credentials: "include" })
              .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`)
                return r.arrayBuffer()
              })
              .then((buffer) => {
                const bytes = new Uint8Array(buffer)
                let binary = ""
                const chunkSize = 8192
                for (let i = 0; i < bytes.length; i += chunkSize) {
                  const chunk = bytes.subarray(i, i + chunkSize)
                  binary += String.fromCharCode.apply(null, Array.from(chunk))
                }
                resolve({
                  success: true,
                  data: btoa(binary),
                })
              })
              .catch((e) => {
                resolve({
                  success: false,
                  data: "",
                  error: e instanceof Error ? e.message : "fetch failed",
                })
              })
          }
        )
      },
      args: [fileUrl],
    })

    if (results && results[0]?.result) {
      const result = results[0].result as {
        success: boolean
        data: string
        error?: string
      }

      if (result.success && result.data) {
        const binaryStr = atob(result.data)
        const bytes = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i)
        }
        return await extractPdfFromData(bytes, fileUrl)
      }

      return {
        success: false,
        title: "",
        content: "",
        pageCount: 0,
        error: result.error || "Failed to read PDF file",
      }
    }
  } catch (error) {
    return {
      success: false,
      title: "",
      content: "",
      pageCount: 0,
      error: error instanceof Error ? error.message : "Script injection failed",
    }
  }

  return {
    success: false,
    title: "",
    content: "",
    pageCount: 0,
    error: "No result from script injection",
  }
}
