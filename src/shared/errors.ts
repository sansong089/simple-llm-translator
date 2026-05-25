import type { ErrorCode, TranslationError } from "./types";

const messages: Record<ErrorCode, string> = {
  SETTINGS_INCOMPLETE: "请先完成 API 配置。",
  UNSUPPORTED_PAGE: "当前页面不支持翻译。",
  API_AUTH_FAILED: "API Key 无效或无权限。",
  API_RATE_LIMITED: "服务商限流，请稍后重试。",
  API_TIMEOUT: "请求超时，请稍后重试或调小批次大小。",
  API_BAD_RESPONSE: "模型返回格式异常，已保留原文。",
  TRANSLATION_STOPPED: "翻译已停止。",
  NODE_CHANGED: "页面内容已变化，已保留原文。",
  HTML_UNSAFE: "模型返回的 HTML 不安全，已保留原文。",
  HTML_STRUCTURE_CHANGED: "模型返回的 HTML 结构异常，已保留原文。",
  NETWORK_ERROR: "网络请求失败，请稍后重试。"
};

export function userMessage(code: ErrorCode): string {
  return messages[code];
}

export function createTranslationError(code: ErrorCode, retryable = false, message = userMessage(code)): TranslationError {
  return { code, message, retryable };
}

export function maskApiKey(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "****";
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}
