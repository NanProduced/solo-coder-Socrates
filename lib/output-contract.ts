import { StructuredOutput } from "./types"

const QUESTION_PATTERNS = [
  /[？?]/,
  /你知道吗/,
  /想一想/,
  /你觉得/,
  /你认为/,
  /是否/,
  /能不能/,
  /会不会/,
  /有没有可能/,
  /what do you think/i,
  /how would you/i,
  /can you/i,
  /do you/i,
  /would you/i,
  /have you/i,
  /are you/i,
  /is it/i,
  /could you/i,
]

const OPTION_LINE_PATTERN = /^([A-F])[).、）]\s*(.+)$/

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])\s*|(?<=\n)\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function extractQuestions(text: string): string[] {
  const sentences = splitIntoSentences(text)
  const questions: string[] = []

  for (const sentence of sentences) {
    for (const pattern of QUESTION_PATTERNS) {
      if (pattern.test(sentence)) {
        if (!questions.includes(sentence)) {
          questions.push(sentence)
        }
        break
      }
    }
  }

  return questions
}

export interface ExtractedOptions {
  options: string[]
  cleanedText: string
}

export function extractOptions(text: string): ExtractedOptions {
  const lines = text.split("\n")
  const optionLines: { index: number; letter: string; text: string }[] = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    const match = trimmed.match(OPTION_LINE_PATTERN)
    if (match) {
      optionLines.push({
        index: i,
        letter: match[1].toUpperCase(),
        text: match[2].trim(),
      })
    }
  }

  if (optionLines.length < 2) {
    return { options: [], cleanedText: text }
  }

  let consecutiveCount = 1
  let bestStart = 0
  let bestEnd = 0
  let currentStart = 0

  for (let i = 1; i < optionLines.length; i++) {
    const lineGap = optionLines[i].index - optionLines[i - 1].index
    if (lineGap <= 2) {
      consecutiveCount++
      if (consecutiveCount > bestEnd - bestStart + 1) {
        bestStart = currentStart
        bestEnd = i
      }
    } else {
      currentStart = i
      consecutiveCount = 1
    }
  }

  if (bestEnd === 0 && optionLines.length >= 2) {
    bestEnd = optionLines.length - 1
  }

  const selectedOptions = optionLines.slice(bestStart, bestEnd + 1)
  const options = selectedOptions.map((o) => o.text).slice(0, 5)

  const removedLineIndices = new Set<number>()
  for (let i = selectedOptions[0].index; i <= selectedOptions[selectedOptions.length - 1].index; i++) {
    removedLineIndices.add(i)
  }
  for (let i = selectedOptions[0].index - 1; i >= 0; i--) {
    if (lines[i].trim() === "") {
      removedLineIndices.add(i)
    } else {
      break
    }
  }
  for (let i = selectedOptions[selectedOptions.length - 1].index + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") {
      removedLineIndices.add(i)
    } else {
      break
    }
  }

  const cleanedLines = lines.filter((_, i) => !removedLineIndices.has(i))
  const cleanedText = cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim()

  return { options, cleanedText }
}

function removeSentenceFromText(text: string, sentence: string): string {
  const escaped = sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return text.replace(new RegExp(escaped + "\\s*"), "").trim()
}

export function validateOutput(
  raw: string,
  mode: "question" | "summary",
  conversationMode?: "free" | "guided"
): StructuredOutput {
  const trimmed = raw.trim()

  if (!trimmed) {
    return {
      mode,
      answer: mode === "summary" ? "暂无总结内容。" : "暂无回复内容。",
      question: "",
    }
  }

  if (mode === "summary") {
    let answer = trimmed
    const questions = extractQuestions(trimmed)
    for (const q of questions) {
      answer = removeSentenceFromText(answer, q)
    }
    answer = answer.replace(/\n{3,}/g, "\n\n").trim()
    if (!answer) {
      answer = trimmed
    }
    return {
      mode: "summary",
      answer,
      question: "",
    }
  }

  const { options, cleanedText } = conversationMode === "guided"
    ? extractOptions(trimmed)
    : { options: [] as string[], cleanedText: trimmed }

  const textForQuestionExtraction = options.length > 0 ? cleanedText : trimmed
  const questions = extractQuestions(textForQuestionExtraction)

  if (questions.length <= 1) {
    const answer = questions.length === 0
      ? textForQuestionExtraction
      : removeSentenceFromText(textForQuestionExtraction, questions[0]).replace(/\n{3,}/g, "\n\n").trim()
    return {
      mode: "question",
      answer: answer || textForQuestionExtraction,
      question: questions[0] || "",
      options: options.length >= 2 ? options : undefined,
    }
  }

  const keptQuestion = questions[0]
  let answer = textForQuestionExtraction
  for (let i = 1; i < questions.length; i++) {
    answer = removeSentenceFromText(answer, questions[i])
  }
  answer = answer.replace(/\n{3,}/g, "\n\n").trim()

  return {
    mode: "question",
    answer: answer || removeSentenceFromText(textForQuestionExtraction, keptQuestion).replace(/\n{3,}/g, "\n\n").trim(),
    question: keptQuestion,
    options: options.length >= 2 ? options : undefined,
  }
}

export function repairOutput(output: StructuredOutput): StructuredOutput {
  const validModes = ["question", "summary"] as const
  const mode = validModes.includes(output.mode as any)
    ? output.mode
    : "question"

  let answer = output.answer
  if (!answer || answer.trim() === "") {
    answer = output.question || "暂无内容"
  }

  let question = output.question || ""
  if (mode === "summary") {
    question = ""
  }

  if (mode === "question" && question) {
    const questions = extractQuestions(question)
    if (questions.length > 1) {
      question = questions[0]
    }
  }

  let options = output.options
  if (mode === "summary") {
    options = undefined
  }
  if (options && options.length < 2) {
    options = undefined
  }
  if (options && options.length > 5) {
    options = options.slice(0, 5)
  }

  return { mode, answer: answer.trim(), question: question.trim(), options }
}

export function extractStreamingDisplay(accumulated: string): string {
  let display = accumulated

  display = display.replace(/<think[\s\S]*?<\/think>/g, "")
  display = display.replace(/<think[\s\S]*$/g, "")
  display = display.replace(/```(\w+)?\s*$/g, "")

  return display.trim()
}

export function formatStructuredContent(output: StructuredOutput): string {
  if (output.mode === "summary" || !output.question) {
    return output.answer
  }

  let content = output.answer + "\n\n---\n\n❓ " + output.question

  if (output.options && output.options.length >= 2) {
    const labels = ["A", "B", "C", "D", "E"]
    content += "\n\n" + output.options.map((opt, i) => `${labels[i]}) ${opt}`).join("\n")
  }

  return content
}

export function formatDisplayContent(output: StructuredOutput): string {
  if (output.mode === "summary" || !output.question) {
    return output.answer
  }

  return output.answer + "\n\n---\n\n❓ " + output.question
}
