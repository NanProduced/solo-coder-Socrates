import {
  KeyConcept,
  KnowledgeCard,
  UnderstandingState,
  KnowledgeDocument,
  OpenAIConfig,
  Message,
  ConversationRound,
} from "./types"
import { callLLM } from "./llm"
import { saveKnowledgeDoc } from "./storage"

const SUMMARY_SYSTEM_PROMPT = `你是一位专业的知识萃取专家，擅长从文档中提炼核心信息并生成高质量的摘要。

## 任务要求
分析提供的文档内容，生成一份全面但精炼的知识摘要。

## 摘要结构
1. **核心主题** - 一句话概括文档的中心议题
2. **主要论点** - 文档试图阐述或证明的关键观点（2-4点）
3. **组织结构** - 文档的章节布局和逻辑推进方式
4. **目标读者** - 这份文档主要面向什么人群
5. **阅读价值** - 读者能从中获得什么关键收获

## 输出要求
- 用中文输出，语言自然流畅
- 摘要长度控制在300-500字
- 准确反映文档的核心内容，不添加主观臆断
- 保持客观中立的语气

请直接输出摘要内容，不要使用markdown格式或标题。`

const KEY_CONCEPTS_SYSTEM_PROMPT = `你是一位概念分析专家，擅长识别和定义文档中的关键概念。

## 任务要求
从提供的文档内容中提取5-12个关键概念，并为每个概念生成清晰的定义。

## 概念分类标准
- **core（核心概念）**：文档的中心主题，理解文档的基石（1-3个）
- **important（重要概念）**：支撑核心论点的关键术语（3-6个）
- **supporting（支撑概念）**：辅助理解的背景概念（2-3个）

## 输出格式
请输出一个严格的JSON数组，格式如下：
[
  {
    "term": "概念术语",
    "definition": "清晰、准确的定义，基于文档内容",
    "importance": "core|important|supporting",
    "relationships": ["相关概念1", "相关概念2"]
  }
]

## 要求
- 概念定义必须基于文档内容，不要使用外部知识
- relationships 字段列出与该概念紧密相关的其他概念术语
- 确保JSON格式严格有效，没有语法错误
- 所有概念必须在文档中实际出现`

const KNOWLEDGE_CARDS_SYSTEM_PROMPT = `你是一位知识卡片设计师，擅长将复杂信息转化为易于理解的知识卡片。

## 任务要求
基于文档内容，生成6-15张知识卡片，每张卡片聚焦一个独立的知识点。

## 卡片类型
- **definition（定义卡片）**：解释一个重要术语或概念
- **example（示例卡片）**：通过具体例子说明抽象概念
- **principle（原则卡片）**：阐述文档中的核心原则或规律
- **relationship（关系卡片）**：描述不同概念之间的关联
- **application（应用卡片）**：说明知识的实际应用场景

## 输出格式
请输出一个严格的JSON数组，格式如下：
[
  {
    "title": "卡片标题（简洁有力）",
    "content": "卡片正文，100-200字，清晰解释这个知识点",
    "category": "definition|example|principle|relationship|application",
    "tags": ["标签1", "标签2"],
    "sourceReference": "可选：原文出处的简要说明"
  }
]

## 要求
- 每张卡片独立完整，可以单独理解
- 内容必须完全基于文档，不引入外部知识
- 标题吸引人但准确
- tags 用简洁的关键词描述卡片主题
- 确保JSON格式严格有效`

const UNDERSTANDING_STATE_SYSTEM_PROMPT = `你是一位学习状态评估专家，能够根据文档内容和对话历史，评估学习者的理解状态并提供下一步建议。

## 任务要求
分析提供的文档内容和对话历史，生成一个结构化的理解状态评估。

## 理解阶段定义
- **introductory（入门阶段）**：刚接触主题，对基本概念有初步认识
- **exploring（探索阶段）**：开始理解核心概念，建立初步关联
- **deepening（深化阶段）**：深入理解概念间关系，能应用知识
- **synthesizing（综合阶段）**：能整合知识形成自己的理解框架
- **mastering（精通阶段）**：完全掌握，能灵活运用和传授

## 输出格式
请输出一个严格的JSON对象，格式如下：
{
  "currentPhase": "introductory|exploring|deepening|synthesizing|mastering",
  "phaseDescription": "描述为什么判断为当前阶段的理由（100-150字）",
  "mastered": ["已掌握的概念1", "已掌握的概念2"],
  "needClarification": [
    {
      "concept": "需要澄清的概念",
      "reason": "为什么需要澄清的具体原因",
      "priority": "high|medium|low"
    }
  ],
  "evidenceStatus": {
    "strong": ["有充分证据表明理解的点"],
    "weak": ["证据不足的点"],
    "missing": ["完全没有涉及的重要点"]
  },
  "nextSteps": [
    {
      "action": "具体的下一步行动建议",
      "rationale": "为什么建议这样做的理由",
      "priority": "high|medium|low"
    }
  ]
}

## 要求
- 如果没有对话历史，基于文档内容进行初始评估
- mastered 列出已经理解或掌握的概念（从关键概念中选择）
- needClarification 列出可能存在困惑或需要深入理解的点
- evidenceStatus 基于对话中的表现评估证据强度
- nextSteps 提供具体、可执行的学习建议
- 确保JSON格式严格有效`

const EXPORT_MARKDOWN_SYSTEM_PROMPT = `你是一位知识文档编辑专家，擅长将结构化的知识文档转化为优美、易读的Markdown格式。

## 任务要求
将提供的知识文档（包含摘要、关键概念、知识卡片、理解状态）转化为一份完整的、具有学习价值的Markdown文档。

## 转化原则
1. **不是简单拼接**：重新组织内容，形成连贯的学习路径
2. **增强可理解性**：添加过渡性文字，让知识之间的关联更清晰
3. **优化结构**：使用合适的Markdown层级和格式
4. **保持准确性**：不改变原始知识内容的含义

## 建议结构
# 文档标题
> 来源：网页/PDF 链接

## 一、核心概览
（基于摘要重新组织，更具引导性）

## 二、关键概念图谱
（将关键概念按重要性和关联性组织，可以添加概念间关系的描述）

## 三、知识卡片集
（将知识卡片按类别或逻辑顺序组织，每张卡片保持独立但有上下文）

## 四、学习状态评估
（基于理解状态，转化为学习建议和下一步行动）

## 五、学习路线建议
（整合所有信息，提供一条推荐的学习路径）

## 要求
- 使用标准Markdown语法
- 语言自然流畅，适合阅读
- 添加适当的表情符号增强阅读体验（但不要过度）
- 总字数控制在1500-3000字
- 确保所有原始知识都被包含，没有遗漏
- 输出完整的Markdown内容`

function createLLMMessages(systemPrompt: string, userContent: string): Message[] {
  return [
    {
      id: crypto.randomUUID(),
      role: "system",
      content: systemPrompt,
      timestamp: Date.now(),
      visible: false,
    },
    {
      id: crypto.randomUUID(),
      role: "user",
      content: userContent,
      timestamp: Date.now(),
      visible: false,
    },
  ]
}

function buildContextContent(
  pageTitle: string,
  pageUrl: string,
  pageContent: string,
  conversationRounds: ConversationRound[] = []
): string {
  let content = `文档标题：${pageTitle || "未命名"}\n`
  content += `文档来源：${pageUrl}\n\n`
  content += `---\n\n`
  content += `文档内容：\n${pageContent.slice(0, 15000)}\n`

  if (conversationRounds.length > 0) {
    content += `\n---\n\n`
    content += `对话历史（共${conversationRounds.length}轮）：\n\n`
    for (const round of conversationRounds.slice(-3)) {
      for (const msg of round.messages.filter(m => m.visible)) {
        if (msg.role === "user") {
          content += `学习者：${msg.content}\n`
        } else if (msg.role === "assistant") {
          content += `导师：${msg.content}\n`
        }
      }
      content += `\n`
    }
  }

  return content
}

async function generateSummary(
  config: OpenAIConfig,
  pageTitle: string,
  pageUrl: string,
  pageContent: string,
  conversationRounds: ConversationRound[] = []
): Promise<string> {
  const userContent = buildContextContent(pageTitle, pageUrl, pageContent, conversationRounds)
  const messages = createLLMMessages(SUMMARY_SYSTEM_PROMPT, userContent)
  return await callLLM(config, messages, 2000)
}

function safeParseJSON<T>(text: string, fallback: T): T {
  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/)
    const contentToParse = jsonMatch ? jsonMatch[1] : text
    const trimmed = contentToParse.trim()
    
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      return JSON.parse(trimmed) as T
    }
    
    const bracketMatch = trimmed.match(/^\s*(\[[\s\S]*\])\s*$/) || trimmed.match(/^\s*(\{[\s\S]*\})\s*$/)
    if (bracketMatch) {
      return JSON.parse(bracketMatch[1]) as T
    }
    
    console.warn("无法解析JSON，使用fallback:", text.substring(0, 200))
    return fallback
  } catch (e) {
    console.warn("JSON解析失败:", e)
    return fallback
  }
}

async function generateKeyConcepts(
  config: OpenAIConfig,
  pageTitle: string,
  pageUrl: string,
  pageContent: string
): Promise<KeyConcept[]> {
  const userContent = buildContextContent(pageTitle, pageUrl, pageContent)
  const messages = createLLMMessages(KEY_CONCEPTS_SYSTEM_PROMPT, userContent)
  const response = await callLLM(config, messages, 3000)
  
  const parsed = safeParseJSON<KeyConcept[]>(response, [])
  
  return parsed.map((concept, index) => ({
    ...concept,
    id: concept.id || `concept-${index}-${Date.now()}`,
  }))
}

async function generateKnowledgeCards(
  config: OpenAIConfig,
  pageTitle: string,
  pageUrl: string,
  pageContent: string
): Promise<KnowledgeCard[]> {
  const userContent = buildContextContent(pageTitle, pageUrl, pageContent)
  const messages = createLLMMessages(KNOWLEDGE_CARDS_SYSTEM_PROMPT, userContent)
  const response = await callLLM(config, messages, 4000)
  
  const parsed = safeParseJSON<KnowledgeCard[]>(response, [])
  
  return parsed.map((card, index) => ({
    ...card,
    id: card.id || `card-${index}-${Date.now()}`,
  }))
}

async function generateUnderstandingState(
  config: OpenAIConfig,
  pageTitle: string,
  pageUrl: string,
  pageContent: string,
  conversationRounds: ConversationRound[] = []
): Promise<UnderstandingState> {
  const userContent = buildContextContent(pageTitle, pageUrl, pageContent, conversationRounds)
  const messages = createLLMMessages(UNDERSTANDING_STATE_SYSTEM_PROMPT, userContent)
  const response = await callLLM(config, messages, 4000)
  
  const fallback: UnderstandingState = {
    currentPhase: "introductory",
    phaseDescription: "初始状态，等待进一步学习",
    mastered: [],
    needClarification: [],
    evidenceStatus: { strong: [], weak: [], missing: [] },
    nextSteps: [],
    lastUpdated: Date.now(),
  }
  
  const parsed = safeParseJSON<UnderstandingState>(response, fallback)
  
  return {
    ...parsed,
    lastUpdated: Date.now(),
  }
}

export interface GenerationProgress {
  stage: "summary" | "concepts" | "cards" | "understanding" | "complete"
  completed: boolean
  error?: string
}

export interface GenerationResult {
  success: boolean
  document?: KnowledgeDocument
  error?: string
  progress?: GenerationProgress[]
}

export async function generateKnowledgeDocument(
  config: OpenAIConfig,
  pageKey: string,
  pageTitle: string,
  pageUrl: string,
  pageContent: string,
  conversationRounds: ConversationRound[] = [],
  onProgress?: (progress: GenerationProgress) => void,
  existingDoc?: KnowledgeDocument | null,
  forceRegenerate: boolean = false
): Promise<GenerationResult> {
  const progress: GenerationProgress[] = []
  const errors: string[] = []
  
  const notifyProgress = (stage: GenerationProgress["stage"], completed: boolean, error?: string) => {
    const p: GenerationProgress = { stage, completed, error }
    progress.push(p)
    onProgress?.(p)
  }

  try {
    const [summaryResult, conceptsResult, cardsResult, understandingResult] = await Promise.allSettled([
      (async () => {
        notifyProgress("summary", false)
        const summary = !forceRegenerate && existingDoc?.summary && existingDoc.summary.length > 0 
          ? existingDoc.summary 
          : await generateSummary(config, pageTitle, pageUrl, pageContent, conversationRounds)
        notifyProgress("summary", true)
        return summary
      })(),
      (async () => {
        notifyProgress("concepts", false)
        const concepts = !forceRegenerate && existingDoc?.keyConcepts && existingDoc.keyConcepts.length > 0 
          ? existingDoc.keyConcepts 
          : await generateKeyConcepts(config, pageTitle, pageUrl, pageContent)
        notifyProgress("concepts", true)
        return concepts
      })(),
      (async () => {
        notifyProgress("cards", false)
        const cards = !forceRegenerate && existingDoc?.knowledgeCards && existingDoc?.knowledgeCards.length > 0 
          ? existingDoc.knowledgeCards 
          : await generateKnowledgeCards(config, pageTitle, pageUrl, pageContent)
        notifyProgress("cards", true)
        return cards
      })(),
      (async () => {
        notifyProgress("understanding", false)
        const state = await generateUnderstandingState(config, pageTitle, pageUrl, pageContent, conversationRounds)
        notifyProgress("understanding", true)
        return state
      })(),
    ])

    let summary = ""
    let keyConcepts: KeyConcept[] = []
    let knowledgeCards: KnowledgeCard[] = []
    let understandingState: UnderstandingState | null = null

    if (summaryResult.status === "fulfilled") {
      summary = summaryResult.value
    } else {
      errors.push(`摘要生成失败: ${summaryResult.reason}`)
      if (existingDoc?.summary) summary = existingDoc.summary
    }

    if (conceptsResult.status === "fulfilled") {
      keyConcepts = conceptsResult.value
    } else {
      errors.push(`关键概念生成失败: ${conceptsResult.reason}`)
      if (existingDoc?.keyConcepts) keyConcepts = existingDoc.keyConcepts
    }

    if (cardsResult.status === "fulfilled") {
      knowledgeCards = cardsResult.value
    } else {
      errors.push(`知识卡片生成失败: ${cardsResult.reason}`)
      if (existingDoc?.knowledgeCards) knowledgeCards = existingDoc.knowledgeCards
    }

    if (understandingResult.status === "fulfilled") {
      understandingState = understandingResult.value
    } else {
      errors.push(`理解状态生成失败: ${understandingResult.reason}`)
      if (existingDoc?.understandingState) understandingState = existingDoc.understandingState
    }

    if (!understandingState) {
      understandingState = {
        currentPhase: "introductory",
        phaseDescription: "初始评估状态",
        mastered: [],
        needClarification: [],
        evidenceStatus: { strong: [], weak: [], missing: [] },
        nextSteps: [],
        lastUpdated: Date.now(),
      }
    }

    const now = Date.now()
    const doc: KnowledgeDocument = {
      id: existingDoc?.id || `doc-${now}`,
      pageKey,
      pageTitle,
      pageUrl,
      summary,
      keyConcepts,
      knowledgeCards,
      understandingState,
      conversationRounds: conversationRounds.map(r => r.id),
      createdAt: existingDoc?.createdAt || now,
      updatedAt: now,
      version: (existingDoc?.version || 0) + 1,
    }

    await saveKnowledgeDoc(doc)

    notifyProgress("complete", true)

    return {
      success: errors.length === 0,
      document: doc,
      error: errors.length > 0 ? errors.join("; ") : undefined,
      progress,
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "未知错误"
    notifyProgress("complete", false, errorMsg)
    return {
      success: false,
      error: errorMsg,
      progress,
    }
  }
}

export async function exportToMarkdown(
  config: OpenAIConfig,
  doc: KnowledgeDocument
): Promise<string> {
  const docContent = JSON.stringify({
    summary: doc.summary,
    keyConcepts: doc.keyConcepts,
    knowledgeCards: doc.knowledgeCards,
    understandingState: doc.understandingState,
  }, null, 2)

  const userContent = `请将以下知识文档转化为优美的Markdown学习笔记：

文档标题：${doc.pageTitle}
文档来源：${doc.pageUrl}

知识文档数据：
${docContent}`

  const messages = createLLMMessages(EXPORT_MARKDOWN_SYSTEM_PROMPT, userContent)
  return await callLLM(config, messages, 8000)
}

export async function updateUnderstandingStateFromConversation(
  config: OpenAIConfig,
  doc: KnowledgeDocument,
  pageContent: string,
  conversationRounds: ConversationRound[]
): Promise<UnderstandingState> {
  return await generateUnderstandingState(
    config,
    doc.pageTitle,
    doc.pageUrl,
    pageContent,
    conversationRounds
  )
}
