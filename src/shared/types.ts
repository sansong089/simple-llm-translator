export type SegmentKind = "text" | "safe-html";

export interface ModelApiConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  jsonOutputMode: boolean;
}

export interface Settings {
  modelConfigs: ModelApiConfig[];
  selectedModelConfigId: string;
  targetLanguage: string;
  requestTimeoutMs: number;
  maxCharsPerBatch: number;
}

export interface SettingsView {
  targetLanguage: string;
  maxCharsPerBatch: number;
}

export interface TranslationSegment {
  id: string;
  kind: SegmentKind;
  text: string;
  context?: "text" | "button" | "label" | "table-cell" | "heading";
}

export interface TranslationItem {
  id: string;
  text: string;
}

export interface StreamingTranslationItem extends TranslationItem {
  done: boolean;
}

export interface TranslationError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export type ErrorCode =
  | "SETTINGS_INCOMPLETE"
  | "UNSUPPORTED_PAGE"
  | "API_AUTH_FAILED"
  | "API_RATE_LIMITED"
  | "API_TIMEOUT"
  | "API_BAD_RESPONSE"
  | "TRANSLATION_STOPPED"
  | "NODE_CHANGED"
  | "HTML_UNSAFE"
  | "HTML_STRUCTURE_CHANGED"
  | "NETWORK_ERROR";

export interface RunnerStatus {
  frameId: number;
  runId?: string;
  status: "idle" | "running" | "stopped";
  pendingCount: number;
  translatingCount: number;
}

export interface TabStatus {
  configured: boolean;
  pageAvailable: boolean;
  status: "idle" | "running" | "stopped" | "unavailable";
  frames: RunnerStatus[];
}
