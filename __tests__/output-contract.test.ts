import { describe, it, expect } from "vitest"
import {
  extractQuestions,
  validateOutput,
  repairOutput,
  extractStreamingDisplay,
  formatStructuredContent,
} from "../lib/output-contract"

describe("extractQuestions", () => {
  it("extracts Chinese question sentences ending with ？", () => {
    const text = "这是一段说明。你觉得这篇文章的核心论点是什么？"
    const questions = extractQuestions(text)
    expect(questions).toHaveLength(1)
    expect(questions[0]).toContain("核心论点")
  })

  it("extracts English question sentences ending with ?", () => {
    const text = "This is a statement. What do you think about this topic?"
    const questions = extractQuestions(text)
    expect(questions.length).toBeGreaterThanOrEqual(1)
    expect(questions.some((q) => q.includes("What do you think"))).toBe(true)
  })

  it("extracts multiple questions", () => {
    const text = "你觉得这个概念是什么？为什么它很重要？你怎么看？"
    const questions = extractQuestions(text)
    expect(questions.length).toBeGreaterThanOrEqual(2)
  })

  it("returns empty array for text without questions", () => {
    const text = "这是一段普通陈述。没有问句。"
    const questions = extractQuestions(text)
    expect(questions).toHaveLength(0)
  })

  it("detects '你知道吗' as question pattern", () => {
    const text = "你知道吗，这个概念其实很有趣。"
    const questions = extractQuestions(text)
    expect(questions.length).toBeGreaterThanOrEqual(1)
  })
})

describe("validateOutput", () => {
  it("validates single question mode correctly", () => {
    const text = "这段内容解释了核心概念。你觉得理解了吗？"
    const result = validateOutput(text, "question")
    expect(result.mode).toBe("question")
    expect(result.question).toBeTruthy()
    expect(result.answer).toBeTruthy()
  })

  it("trims multiple questions to one in question mode", () => {
    const text = "你觉得这个概念是什么？为什么它很重要？你怎么看？"
    const result = validateOutput(text, "question")
    expect(result.mode).toBe("question")
    expect(result.question).toBeTruthy()
    const questionsInResult = extractQuestions(result.question)
    expect(questionsInResult.length).toBeLessThanOrEqual(1)
  })

  it("strips all questions in summary mode", () => {
    const text = "这篇文章的核心主题是AI。你觉得AI重要吗？总结来说，AI正在改变世界。"
    const result = validateOutput(text, "summary")
    expect(result.mode).toBe("summary")
    expect(result.question).toBe("")
    expect(result.answer).not.toContain("？")
  })

  it("handles empty input with fallback", () => {
    const result = validateOutput("", "question")
    expect(result.mode).toBe("question")
    expect(result.answer).toBeTruthy()
  })

  it("handles whitespace-only input", () => {
    const result = validateOutput("   \n  ", "summary")
    expect(result.mode).toBe("summary")
    expect(result.answer).toBeTruthy()
    expect(result.question).toBe("")
  })

  it("preserves answer content when no questions present", () => {
    const text = "这是一段纯陈述性内容。没有任何问句。"
    const result = validateOutput(text, "question")
    expect(result.answer).toContain("纯陈述性内容")
    expect(result.question).toBe("")
  })

  it("summary mode falls back to full text if all content is questions", () => {
    const text = "你觉得这个怎么样？"
    const result = validateOutput(text, "summary")
    expect(result.mode).toBe("summary")
    expect(result.answer).toBeTruthy()
  })
})

describe("repairOutput", () => {
  it("fixes invalid mode", () => {
    const output = { mode: "invalid" as any, answer: "test", question: "" }
    const repaired = repairOutput(output)
    expect(repaired.mode).toBe("question")
  })

  it("clears question in summary mode", () => {
    const output = {
      mode: "summary" as const,
      answer: "总结内容",
      question: "这是一个问题？",
    }
    const repaired = repairOutput(output)
    expect(repaired.question).toBe("")
  })

  it("fills empty answer with question as fallback", () => {
    const output = {
      mode: "question" as const,
      answer: "",
      question: "这是问题？",
    }
    const repaired = repairOutput(output)
    expect(repaired.answer).toBeTruthy()
  })

  it("fills empty answer with default when both empty", () => {
    const output = { mode: "question" as const, answer: "", question: "" }
    const repaired = repairOutput(output)
    expect(repaired.answer).toBeTruthy()
  })

  it("trims multiple questions in question field to one", () => {
    const output = {
      mode: "question" as const,
      answer: "说明",
      question: "问题一？问题二？",
    }
    const repaired = repairOutput(output)
    const questions = extractQuestions(repaired.question)
    expect(questions.length).toBeLessThanOrEqual(1)
  })
})

describe("extractStreamingDisplay", () => {
  it("removes think tags", () => {
    const text = '你好<think\n思考内容\n</think\n这是正文'
    const display = extractStreamingDisplay(text)
    expect(display).not.toContain("think")
    expect(display).toContain("你好")
  })

  it("removes incomplete think tags", () => {
    const text = "你好<think\n还在思考中"
    const display = extractStreamingDisplay(text)
    expect(display).not.toContain("think")
  })

  it("removes incomplete code blocks", () => {
    const text = "代码如下：\n```python\n"
    const display = extractStreamingDisplay(text)
    expect(display).not.toContain("```")
  })

  it("preserves normal text", () => {
    const text = "这是一段正常的文本内容"
    const display = extractStreamingDisplay(text)
    expect(display).toBe(text)
  })
})

describe("formatStructuredContent", () => {
  it("formats question mode with question", () => {
    const output = {
      mode: "question" as const,
      answer: "这是回答",
      question: "这是问题？",
    }
    const formatted = formatStructuredContent(output)
    expect(formatted).toContain("这是回答")
    expect(formatted).toContain("❓")
    expect(formatted).toContain("这是问题")
  })

  it("formats summary mode without question", () => {
    const output = {
      mode: "summary" as const,
      answer: "这是总结",
      question: "",
    }
    const formatted = formatStructuredContent(output)
    expect(formatted).toBe("这是总结")
    expect(formatted).not.toContain("❓")
  })

  it("formats question mode without question field", () => {
    const output = {
      mode: "question" as const,
      answer: "纯陈述内容",
      question: "",
    }
    const formatted = formatStructuredContent(output)
    expect(formatted).toBe("纯陈述内容")
  })
})
