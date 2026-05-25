import type { ModelApiConfig } from "./types";

export const CHAT_COMPLETIONS_PATH = "/chat/completions";

export const DEFAULT_MODEL_CONFIG: ModelApiConfig = {
  id: "default",
  name: "默认接口",
  baseUrl: "",
  apiKey: "",
  model: "",
  jsonOutputMode: false
};

export const DEFAULT_SETTINGS = {
  modelConfigs: [DEFAULT_MODEL_CONFIG],
  selectedModelConfigId: DEFAULT_MODEL_CONFIG.id,
  targetLanguage: "中文",
  requestTimeoutMs: 30_000,
  maxCharsPerBatch: 12_000
} as const;

export const MENU_IDS = {
  translatePage: "translate-page",
  translateSelection: "translate-selection",
  stopPageTranslation: "stop-page-translation"
} as const;

export const FRAME_ID_TOP = 0;
