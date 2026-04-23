import {
  countQuestions,
  isValidSingleQuestion,
  isSummaryResponse,
  validateResponse,
  extractFirstQuestion,
  removeTrailingQuestions,
  stripThinkTags,
  buildSystemPrompt,
} from "./llm-service"
import type { ConversationMode } from "./types"

interface TestResult {
  name: string
  passed: boolean
  expected: unknown
  actual: unknown
}

function assertEqual(actual: unknown, expected: unknown, name: string): TestResult {
  const passed = actual === expected
  return {
    name,
    passed,
    expected,
    actual,
  }
}

function runTests(): TestResult[] {
  const results: TestResult[] = []

  results.push(assertEqual(countQuestions("你好吗？"), 1, "countQuestions: 单个中文问号"))
  results.push(assertEqual(countQuestions("How are you?"), 1, "countQuestions: 单个英文问号"))
  results.push(assertEqual(countQuestions("你好？还是不好？"), 2, "countQuestions: 两个问题"))
  results.push(assertEqual(countQuestions("这是一个陈述句。"), 0, "countQuestions: 无问题"))
  results.push(assertEqual(countQuestions("你觉得这个论点对吗？为什么？"), 2, "countQuestions: 连续两个问题"))

  results.push(assertEqual(isValidSingleQuestion("你觉得这篇文章的核心论点是什么？"), true, "isValidSingleQuestion: 有效单问题"))
  results.push(assertEqual(isValidSingleQuestion("你觉得这个论点对吗？为什么？"), false, "isValidSingleQuestion: 无效双问题"))
  results.push(assertEqual(isValidSingleQuestion("这是一个陈述句。"), false, "isValidSingleQuestion: 无问题标记"))

  results.push(assertEqual(isSummaryResponse("本文的核心主题是人工智能的发展历史。"), true, "isSummaryResponse: 包含核心主题"))
  results.push(assertEqual(isSummaryResponse("主要要点包括：1. 数据结构，2. 算法设计。"), true, "isSummaryResponse: 包含主要要点"))
  results.push(assertEqual(isSummaryResponse("你觉得这篇文章的核心是什么？"), false, "isSummaryResponse: 问题形式不是总结"))

  const summaryContent = "这是一个总结。你还有问题吗？"
  const validateSummaryResult = validateResponse(summaryContent, "summary")
  results.push(assertEqual(
    validateSummaryResult.issues.length > 0,
    true,
    "validateResponse: 总结模式检测到尾部问题"
  ))

  const singleQContent = "你觉得这个论点对吗？为什么？"
  const validateSingleQResult = validateResponse(singleQContent, "single_question")
  results.push(assertEqual(
    validateSingleQResult.issues.length > 0,
    true,
    "validateResponse: 单问题模式检测到多问题"
  ))

  results.push(assertEqual(
    extractFirstQuestion("你觉得这个论点对吗？为什么？"),
    "你觉得这个论点对吗？",
    "extractFirstQuestion: 提取第一个问题"
  ))

  results.push(assertEqual(
    extractFirstQuestion("这是前言。你好吗？这是后续。"),
    "你好吗？",
    "extractFirstQuestion: 从前言中提取问题"
  ))

  const withTrailing = "这是核心要点。你还有其他问题吗？"
  const cleaned = removeTrailingQuestions(withTrailing)
  results.push(assertEqual(
    cleaned.includes("？") || cleaned.includes("?"),
    false,
    "removeTrailingQuestions: 移除尾部问题标记"
  ))

  results.push(assertEqual(
    stripThinkTags("<think>这是思考内容</think>这是实际回答"),
    "这是实际回答",
    "stripThinkTags: 移除完整think标签"
  ))

  results.push(assertEqual(
    stripThinkTags("<think>未闭合的思考"),
    "",
    "stripThinkTags: 移除未闭合think标签"
  ))

  const singleQPrompt = buildSystemPrompt("single_question")
  results.push(assertEqual(
    singleQPrompt.includes("一次只问一个问题"),
    true,
    "buildSystemPrompt: 单问题模式包含正确指令"
  ))

  const summaryPrompt = buildSystemPrompt("summary")
  results.push(assertEqual(
    summaryPrompt.includes("总结模式规则"),
    true,
    "buildSystemPrompt: 总结模式包含正确指令"
  ))

  results.push(assertEqual(
    summaryPrompt.includes("不要提问"),
    true,
    "buildSystemPrompt: 总结模式包含不要提问指令"
  ))

  return results
}

export function runAllTests(): { passed: number; failed: number; results: TestResult[] } {
  const results = runTests()
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length

  console.log("=== LLM Service 测试结果 ===")
  console.log(`通过: ${passed}, 失败: ${failed}`)
  console.log("")

  results.forEach((result, index) => {
    const status = result.passed ? "✅" : "❌"
    console.log(`${status} ${index + 1}. ${result.name}`)
    if (!result.passed) {
      console.log(`   期望: ${JSON.stringify(result.expected)}`)
      console.log(`   实际: ${JSON.stringify(result.actual)}`)
    }
  })

  return { passed, failed, results }
}

if (typeof window !== "undefined") {
  ;(window as any).runLLMServiceTests = runAllTests
}
