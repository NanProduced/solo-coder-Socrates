export interface OpenAIConfig {
  baseURL: string
  apiKey: string
  model: string
}

export const DEFAULT_OPENAI_CONFIG: OpenAIConfig = {
  baseURL: "",
  apiKey: "",
  model: "gpt-4o"
}
