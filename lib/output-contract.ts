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

  const questions = extractQuestions(trimmed)

  if (mode === "summary") {
    let answer = trimmed
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

  if (questions.length <= 1) {
    return {
      mode: "question",
      answer: questions.length === 0 ? trimmed : removeSentenceFromText(trimmed, questions[0]).replace(/\n{3,}/g, "\n\n").trim(),
      question: questions[0] || "",
    }
  }

  const keptQuestion = questions[0]
  let answer = trimmed
  for (let i = 1; i < questions.length; i++) {
    answer = removeSentenceFromText(answer, questions[i])
  }
  answer = answer.replace(/\n{3,}/g, "\n\n").trim()

  return {
    mode: "question",
    answer: answer || removeSentenceFromText(trimmed, keptQuestion).replace(/\n{3,}/g, "\n\n").trim(),
    question: keptQuestion,
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

  return { mode, answer: answer.trim(), question: question.trim() }
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
