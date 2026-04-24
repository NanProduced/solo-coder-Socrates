import { describe, it, expect } from "vitest"
import {
  parseLLMJson,
  formatDateGroup,
  extractHostname,
  buildStatusContext,
  mergeKnowledgeDoc,
  findRelatedConcepts,
} from "../lib/utils"
import { UnderstandingStatus, KnowledgeDocument } from "../lib/types"

describe("parseLLMJson", () => {
  it("parses plain JSON object", () => {
    const result = parseLLMJson('{"key": "value"}')
    expect(result).toEqual({ key: "value" })
  })

  it("extracts JSON from code block", () => {
    const text = '```json\n{"key": "value"}\n```'
    const result = parseLLMJson(text)
    expect(result).toEqual({ key: "value" })
  })

  it("extracts JSON from code block without language tag", () => {
    const text = '```\n{"key": "value"}\n```'
    const result = parseLLMJson(text)
    expect(result).toEqual({ key: "value" })
  })

  it("extracts JSON from text with surrounding content", () => {
    const text = 'Here is the result: {"key": "value"} and more'
    const result = parseLLMJson(text)
    expect(result).toEqual({ key: "value" })
  })

  it("handles nested JSON objects", () => {
    const text = '{"outer": {"inner": 42}}'
    const result = parseLLMJson(text)
    expect(result.outer.inner).toBe(42)
  })

  it("throws on invalid JSON", () => {
    expect(() => parseLLMJson("not json at all")).toThrow()
  })

  it("handles whitespace around JSON", () => {
    const result = parseLLMJson('  \n  {"key": "value"}  \n  ')
    expect(result).toEqual({ key: "value" })
  })
})

describe("formatDateGroup", () => {
  it("returns 今天 for today's timestamp", () => {
    expect(formatDateGroup(Date.now())).toBe("今天")
  })

  it("returns 昨天 for yesterday's timestamp", () => {
    const yesterday = Date.now() - 86400000
    expect(formatDateGroup(yesterday)).toBe("昨天")
  })

  it("returns 最近七天 for 3 days ago", () => {
    const threeDaysAgo = Date.now() - 3 * 86400000
    expect(formatDateGroup(threeDaysAgo)).toBe("最近七天")
  })

  it("returns 最近三十天 for 15 days ago", () => {
    const fifteenDaysAgo = Date.now() - 15 * 86400000
    expect(formatDateGroup(fifteenDaysAgo)).toBe("最近三十天")
  })

  it("returns 更早 for 60 days ago", () => {
    const sixtyDaysAgo = Date.now() - 60 * 86400000
    expect(formatDateGroup(sixtyDaysAgo)).toBe("更早")
  })
})

describe("extractHostname", () => {
  it("extracts hostname from https URL", () => {
    expect(extractHostname("https://www.example.com/path")).toBe("www.example.com")
  })

  it("extracts hostname without www", () => {
    expect(extractHostname("https://example.com/path")).toBe("example.com")
  })

  it("returns filename for file:// URLs", () => {
    const result = extractHostname("file:///C:/Users/test/doc.pdf")
    expect(result).toBe("doc.pdf")
  })

  it("returns 本地文件 for file:// URL without filename", () => {
    const result = extractHostname("file:///C:/Users/test/")
    expect(result).toBe("本地文件")
  })

  it("returns original string for invalid URL", () => {
    expect(extractHostname("not-a-url")).toBe("not-a-url")
  })
})

describe("buildStatusContext", () => {
  it("returns empty string for null status", () => {
    expect(buildStatusContext(null)).toBe("")
  })

  it("includes current stage", () => {
    const status: UnderstandingStatus = {
      currentStage: "深入理解",
      mastered: [],
      pendingClarification: [],
      evidenceStatus: "中",
      nextThinkingDirection: "",
      updatedAt: Date.now(),
    }
    const ctx = buildStatusContext(status)
    expect(ctx).toContain("深入理解")
    expect(ctx).toContain("当前学习状态")
  })

  it("includes mastered concepts", () => {
    const status: UnderstandingStatus = {
      currentStage: "建立框架",
      mastered: ["概念A", "概念B"],
      pendingClarification: [],
      evidenceStatus: "中",
      nextThinkingDirection: "",
      updatedAt: Date.now(),
    }
    const ctx = buildStatusContext(status)
    expect(ctx).toContain("概念A")
    expect(ctx).toContain("已掌握")
  })

  it("includes pending clarification", () => {
    const status: UnderstandingStatus = {
      currentStage: "初步接触",
      mastered: [],
      pendingClarification: ["概念X"],
      evidenceStatus: "低",
      nextThinkingDirection: "",
      updatedAt: Date.now(),
    }
    const ctx = buildStatusContext(status)
    expect(ctx).toContain("概念X")
    expect(ctx).toContain("待澄清")
  })

  it("includes thinking direction when present", () => {
    const status: UnderstandingStatus = {
      currentStage: "初步接触",
      mastered: [],
      pendingClarification: [],
      evidenceStatus: "低",
      nextThinkingDirection: "思考概念之间的关系",
      updatedAt: Date.now(),
    }
    const ctx = buildStatusContext(status)
    expect(ctx).toContain("思考概念之间的关系")
  })

  it("includes strategy guidance", () => {
    const status: UnderstandingStatus = {
      currentStage: "初步接触",
      mastered: [],
      pendingClarification: [],
      evidenceStatus: "低",
      nextThinkingDirection: "",
      updatedAt: Date.now(),
    }
    const ctx = buildStatusContext(status)
    expect(ctx).toContain("调整提问策略")
  })
})

describe("mergeKnowledgeDoc", () => {
  const baseDoc: KnowledgeDocument = {
    pageKey: "test-page",
    summary: "旧摘要",
    keyConcepts: [
      { name: "概念A", description: "描述A" },
      { name: "概念B", description: "描述B" },
    ],
    knowledgeCards: [
      { concept: "概念A", explanation: "解释A", keyPoints: ["要点1"] },
    ],
    understandingStatus: {
      currentStage: "初步接触",
      mastered: [],
      pendingClarification: [],
      evidenceStatus: "低",
      nextThinkingDirection: "",
      updatedAt: Date.now(),
    },
    createdAt: 1000,
    updatedAt: 2000,
    pageTitle: "测试文档",
    pageUrl: "https://example.com",
  }

  it("creates new doc when oldDoc is null", () => {
    const updates = {
      summary: "新摘要",
      keyConcepts: [{ name: "概念X", description: "描述X" }],
      knowledgeCards: [],
      understandingStatus: baseDoc.understandingStatus,
    }
    const result = mergeKnowledgeDoc(null, updates)
    expect(result.summary).toBe("新摘要")
  })

  it("merges summary from updates", () => {
    const result = mergeKnowledgeDoc(baseDoc, { summary: "新摘要" })
    expect(result.summary).toBe("新摘要")
  })

  it("preserves old summary when not provided", () => {
    const result = mergeKnowledgeDoc(baseDoc, {})
    expect(result.summary).toBe("旧摘要")
  })

  it("merges concepts by name (dedup)", () => {
    const result = mergeKnowledgeDoc(baseDoc, {
      keyConcepts: [
        { name: "概念A", description: "新描述A" },
        { name: "概念C", description: "描述C" },
      ],
    })
    const names = result.keyConcepts.map((c) => c.name)
    expect(names).toContain("概念A")
    expect(names).toContain("概念B")
    expect(names).toContain("概念C")
    const conceptA = result.keyConcepts.find((c) => c.name === "概念A")
    expect(conceptA?.description).toBe("新描述A")
  })

  it("preserves old knowledgeCards when not provided", () => {
    const result = mergeKnowledgeDoc(baseDoc, {})
    expect(result.knowledgeCards).toHaveLength(1)
  })

  it("updates updatedAt timestamp", () => {
    const before = Date.now()
    const result = mergeKnowledgeDoc(baseDoc, { summary: "更新" })
    expect(result.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it("preserves createdAt and metadata", () => {
    const result = mergeKnowledgeDoc(baseDoc, { summary: "更新" })
    expect(result.createdAt).toBe(baseDoc.createdAt)
    expect(result.pageTitle).toBe(baseDoc.pageTitle)
    expect(result.pageUrl).toBe(baseDoc.pageUrl)
    expect(result.pageKey).toBe(baseDoc.pageKey)
  })
})

describe("findRelatedConcepts", () => {
  const docs: KnowledgeDocument[] = [
    {
      pageKey: "doc-1",
      summary: "",
      keyConcepts: [
        { name: "React", description: "UI library" },
        { name: "Hooks", description: "React feature" },
      ],
      knowledgeCards: [],
      understandingStatus: {
        currentStage: "初步接触",
        mastered: [],
        pendingClarification: [],
        evidenceStatus: "低",
        nextThinkingDirection: "",
        updatedAt: Date.now(),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pageTitle: "React 入门",
      pageUrl: "https://example.com/react",
    },
    {
      pageKey: "doc-2",
      summary: "",
      keyConcepts: [
        { name: "React", description: "UI framework" },
        { name: "Vue", description: "Another framework" },
      ],
      knowledgeCards: [],
      understandingStatus: {
        currentStage: "初步接触",
        mastered: [],
        pendingClarification: [],
        evidenceStatus: "低",
        nextThinkingDirection: "",
        updatedAt: Date.now(),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pageTitle: "Vue 入门",
      pageUrl: "https://example.com/vue",
    },
  ]

  it("finds shared concepts across documents", () => {
    const related = findRelatedConcepts(["React"], docs, "doc-1")
    expect(related.length).toBeGreaterThan(0)
    expect(related[0].concept).toBe("React")
    expect(related[0].docTitle).toBe("Vue 入门")
  })

  it("skips current document", () => {
    const related = findRelatedConcepts(["React"], docs, "doc-1")
    expect(related.every((r) => r.docTitle !== "React 入门")).toBe(true)
  })

  it("returns empty for no matches", () => {
    const related = findRelatedConcepts(["Angular"], docs, "doc-1")
    expect(related).toHaveLength(0)
  })

  it("limits results to 5", () => {
    const manyDocs: KnowledgeDocument[] = Array.from({ length: 10 }, (_, i) => ({
      pageKey: `doc-${i}`,
      summary: "",
      keyConcepts: [{ name: "React", description: `desc ${i}` }],
      knowledgeCards: [],
      understandingStatus: {
        currentStage: "初步接触",
        mastered: [],
        pendingClarification: [],
        evidenceStatus: "低",
        nextThinkingDirection: "",
        updatedAt: Date.now(),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pageTitle: `Doc ${i}`,
      pageUrl: `https://example.com/${i}`,
    }))
    const related = findRelatedConcepts(["React"], manyDocs, "doc-0")
    expect(related.length).toBeLessThanOrEqual(5)
  })

  it("is case insensitive", () => {
    const related = findRelatedConcepts(["react"], docs, "doc-1")
    expect(related.length).toBeGreaterThan(0)
  })
})
