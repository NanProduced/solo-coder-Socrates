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

const OPTION_PATTERNS = [
  /^[ABCD][\.、．]\s*(.+)$/i,
  /^[①②③④]\s*(.+)$/,
  /^[(（][ABCD][)）]\s*(.+)$/i,
]

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])\s*|(?<=\n)\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function extractOptionsFromLine(line: string): string | null {
  for (const pattern of OPTION_PATTERNS) {
    const match = line.match(pattern)
    if (match && match[1]) {
      return match[1].trim()
    }
  }
  return null
}

function extractOptions(text: string): string[] {
  const lines = text.split("\n").map((s) => s.trim()).filter((s) => s.length > 0)
  const options: string[] = []
  let inOptionSection = false

  for (const line of lines) {
    const option = extractOptionsFromLine(line)
    if (option) {
      inOptionSection = true
      if (!options.includes(option)) {
        options.push(option)
      }
    } else if (inOptionSection) {
      if (!QUESTION_PATTERNS.some((p) => p.test(line))) {
        continue
      }
      break
    }
  }

  if (options.length >= 3 && options.length <= 4) {
    return options
  }
  return []
}

function removeOptionsFromText(text: string): string {
  const lines = text.split("\n")
  const filteredLines: string[] = []
  let inOptionSection = false

  for (const line of lines) {
    const trimmed = line.trim()
    const option = extractOptionsFromLine(trimmed)

    if (option) {
      inOptionSection = true
      continue
    }

    if (inOptionSection && trimmed.length === 0) {
      continue
    }

    if (inOptionSection && trimmed.length > 0 && !option) {
      inOptionSection = false
    }

    filteredLines.push(line)
  }

  return filteredLines.join("\n").trim()
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

function removeSentenceFromText(text: string, sentence: string): string {
  const escaped = sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return text.replace(new RegExp(escaped + "\\s*"), "").trim()
}

export function validateOutput(
  raw: string,
  mode: "question" | "summary"
): StructuredOutput {
  const trimmed = raw.trim()

  if (!trimmed) {
    return {
      mode,
      answer: mode === "summary" ? "暂无总结内容。" : "暂无回复内容。",
      question: "",
    }
  }

  const options = extractOptions(trimmed)
  const textWithoutOptions = options.length > 0 ? removeOptionsFromText(trimmed) : trimmed

  const questions = extractQuestions(textWithoutOptions)

  if (mode === "summary") {
    let answer = textWithoutOptions
    for (const q of questions) {
      answer = removeSentenceFromText(answer, q)
    }
    answer = answer.replace(/\n{3,}/g, "\n\n").trim()
    if (!answer) {
      answer = textWithoutOptions
    }
    return {
      mode: "summary",
      answer,
      question: "",
    }
  }

  if (questions.length <= 1) {
    return {
      mode: "question",
      answer: questions.length === 0 ? textWithoutOptions : removeSentenceFromText(textWithoutOptions, questions[0]).replace(/\n{3,}/g, "\n\n").trim(),
      question: questions[0] || "",
      options: options.length > 0 ? options : undefined,
    }
  }

  const keptQuestion = questions[0]
  let answer = textWithoutOptions
  for (let i = 1; i < questions.length; i++) {
    answer = removeSentenceFromText(answer, questions[i])
  }
  answer = answer.replace(/\n{3,}/g, "\n\n").trim()

  return {
    mode: "question",
    answer: answer || removeSentenceFromText(textWithoutOptions, keptQuestion).replace(/\n{3,}/g, "\n\n").trim(),
    question: keptQuestion,
    options: options.length > 0 ? options : undefined,
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
  if (options && options.length > 0) {
    options = options.filter((o) => o && o.trim().length > 0)
    if (options.length < 3 || options.length > 4) {
      options = undefined
    }
  }

  return { 
    mode, 
    answer: answer.trim(), 
    question: question.trim(),
    options: options && options.length > 0 ? options : undefined
  }
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

  return output.answer + "\n\n---\n\n❓ " + output.question
}
