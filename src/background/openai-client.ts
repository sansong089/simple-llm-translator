import { CHAT_COMPLETIONS_PATH } from "../shared/constants";
import {
  buildStreamingProtocolPrompt,
  buildUserPayload,
  createStreamingTranslationParser,
  parseTranslationResponse
} from "../shared/batch-protocol";
import { appendDiagnosticEntry } from "./diagnostic-log";
import { createTranslationError, maskApiKey } from "../shared/errors";
import type {
  Settings,
  StreamingTranslationItem,
  TranslationError,
  TranslationItem,
  TranslationSegment
} from "../shared/types";
import { getSelectedModelConfig } from "./settings-store";

const BASE_SYSTEM_PROMPT = [
  "你是网页翻译引擎。请自动识别源语言，将每个输入片段翻译为目标语言。",
  "保持 URL、代码、数字、变量名、产品名和专有名词的含义。",
  "即使片段中包含产品名、模块名、函数名、文件路径、链接文字或技术术语，也必须翻译周围的自然语言；只保留这些技术标识本身，不要把整句原样保留。",
  "对于像“See: Hello Lua script.”、“The Lua API documentation is provided here Lua API Reference”这样的技术说明句，必须翻译整句自然语言，只保留必要的专有名词或链接目标名。",
  "如果输入片段包含 HTML 标签，只翻译标签内可见文本，必须完整保留所有 HTML 标签、属性、开始标签和结束标签，不得新增、删除、重排或拆散标签。",
  "如果某个片段不需要翻译，原样返回。"
].join("\n");

const JSON_SYSTEM_PROMPT = [
  BASE_SYSTEM_PROMPT,
  "只返回严格 JSON 对象，不要 Markdown，不要解释，不要额外字段。",
  '返回格式必须是：{"items":[{"id":"原输入 id","text":"译文"}]}。',
  '示例：输入 {"targetLanguage":"中文","segments":[{"id":"selection","kind":"text","text":"Hello"}]} 时，只能返回 {"items":[{"id":"selection","text":"你好"}]}。'
].join("\n");

const STREAM_SYSTEM_PROMPT = [BASE_SYSTEM_PROMPT, buildStreamingProtocolPrompt()].join("\n");
const diagnosticSegments = (segments: TranslationSegment[]) =>
  segments.map((segment) => ({
    id: segment.id,
    kind: segment.kind,
    text: segment.text,
    context: segment.context
  }));

function scheduleDiagnosticEntry(entry: Parameters<typeof appendDiagnosticEntry>[0]): void {
  void appendDiagnosticEntry(entry);
}

export interface StreamTranslateOptions {
  allowPlainTextFallback?: boolean;
  onUpdate?: (item: StreamingTranslationItem) => void | Promise<void>;
}

export interface StreamTranslateResult {
  ok: boolean;
  items: TranslationItem[];
  error?: TranslationError;
}

export async function translateSegments(
  settings: Settings,
  targetLanguage: string,
  segments: TranslationSegment[],
  options: { allowPlainTextFallback?: boolean } = {}
): Promise<{ ok: true; items: TranslationItem[] } | { ok: false; error: TranslationError }> {
  const result = await requestTranslation(settings, targetLanguage, segments, options);
  return result.ok
    ? { ok: true, items: result.items }
    : { ok: false, error: result.error ?? createTranslationError("NETWORK_ERROR", true) };
}

export async function streamTranslateSegments(
  settings: Settings,
  targetLanguage: string,
  segments: TranslationSegment[],
  options: StreamTranslateOptions = {}
): Promise<StreamTranslateResult> {
  return requestTranslation(settings, targetLanguage, segments, options, true);
}

async function requestTranslation(
  settings: Settings,
  targetLanguage: string,
  segments: TranslationSegment[],
  options: StreamTranslateOptions = {},
  preferStreaming = false
): Promise<StreamTranslateResult> {
  const modelConfig = getSelectedModelConfig(settings);
  if (!modelConfig) {
    return {
      ok: false,
      items: [],
      error: createTranslationError("SETTINGS_INCOMPLETE", false, "未找到已选中的模型接口配置。")
    };
  }

  const endpoint = `${modelConfig.baseUrl}${CHAT_COMPLETIONS_PATH}`;
  const requestedIds = segments.map((segment) => segment.id);

  return withRetries(async () => {
    let emittedAnyUpdate = false;
    const emitUpdate = async (item: StreamingTranslationItem): Promise<void> => {
      emittedAnyUpdate = true;
      await options.onUpdate?.(item);
    };

    const controller = new AbortController();
    let timeoutId = globalThis.setTimeout(() => controller.abort(), settings.requestTimeoutMs);
    const refreshTimeout = (): void => {
      globalThis.clearTimeout(timeoutId);
      timeoutId = globalThis.setTimeout(() => controller.abort(), settings.requestTimeoutMs);
    };
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${modelConfig.apiKey}`
        },
        body: JSON.stringify(buildRequestBody(modelConfig.model, targetLanguage, segments, modelConfig.jsonOutputMode, preferStreaming)),
        signal: controller.signal
      });

      if (!response.ok) {
        return {
          ok: false as const,
          emittedAnyUpdate,
          items: [],
          error: errorFromStatus(response.status, await safeResponseText(response), modelConfig.apiKey)
        };
      }

      if (preferStreaming && isEventStream(response)) {
        return await handleStreamingResponse(
          response,
          requestedIds,
          segments,
          emitUpdate,
          options,
          endpoint,
          modelConfig.model,
          targetLanguage,
          refreshTimeout
        );
      }

      const fallback = await handleJsonResponse(response, segments, options);
      if (fallback.ok) {
        for (const item of fallback.items) {
          await emitUpdate({ ...item, done: true });
        }
        scheduleDiagnosticEntry({
          timestamp: new Date().toISOString(),
          mode: "json",
          endpoint,
          model: modelConfig.model,
          targetLanguage,
          segmentCount: segments.length,
          segments: diagnosticSegments(segments),
          parsedItems: fallback.items
        });
      } else {
        scheduleDiagnosticEntry({
          timestamp: new Date().toISOString(),
          mode: "json",
          endpoint,
          model: modelConfig.model,
          targetLanguage,
          segmentCount: segments.length,
          segments: diagnosticSegments(segments),
          error: fallback.error?.message ?? "unknown error"
        });
      }
      return { ...fallback, emittedAnyUpdate };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return {
          ok: false as const,
          emittedAnyUpdate,
          items: [],
          error: createTranslationError("API_TIMEOUT", true)
        };
      }
      return {
        ok: false as const,
        emittedAnyUpdate,
        items: [],
        error: createTranslationError("NETWORK_ERROR", true)
      };
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  });
}

function buildRequestBody(
  model: string,
  targetLanguage: string,
  segments: TranslationSegment[],
  jsonOutputMode: boolean,
  preferStreaming: boolean
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    temperature: 0,
    messages: [
      { role: "system", content: preferStreaming ? STREAM_SYSTEM_PROMPT : JSON_SYSTEM_PROMPT },
      { role: "user", content: buildUserPayload(targetLanguage, segments) }
    ]
  };

  if (jsonOutputMode && !preferStreaming) {
    body.response_format = { type: "json_object" };
  }
  if (preferStreaming) {
    body.stream = true;
  }
  return body;
}

async function handleStreamingResponse(
  response: Response,
  requestedIds: string[],
  segments: TranslationSegment[],
  emitUpdate: (item: StreamingTranslationItem) => Promise<void>,
  options: StreamTranslateOptions,
  endpoint: string,
  model: string,
  targetLanguage: string,
  refreshTimeout?: () => void
): Promise<{ ok: boolean; items: TranslationItem[]; error?: TranslationError; emittedAnyUpdate: boolean }> {
  const parser = createStreamingTranslationParser(requestedIds);
  const decoder = new TextDecoder();
  const reader = response.body?.getReader();
  if (!reader) {
    const fallback = await handleJsonResponse(response, segments, options);
    return { ...fallback, emittedAnyUpdate: false };
  }

  let lineBuffer = "";
  let eventLines: string[] = [];
  let emittedAnyUpdate = false;
  let sawDone = false;
  let rawResponse = "";
  let streamReadError: unknown;

  while (true) {
    let readResult: ReadableStreamReadResult<Uint8Array>;
    try {
      readResult = await reader.read();
    } catch (error) {
      streamReadError = error;
      break;
    }
    const { value, done } = readResult;
    if (done) break;
    refreshTimeout?.();
    const decoded = decoder.decode(value, { stream: true });
    rawResponse += decoded;
    lineBuffer += decoded;
    const parsed = await consumeSseLines(lineBuffer, eventLines, parser, emitUpdate);
    lineBuffer = parsed.lineBuffer;
    eventLines = parsed.eventLines;
    emittedAnyUpdate ||= parsed.emittedAnyUpdate;
    if (parsed.sawDone) {
      sawDone = true;
      break;
    }
  }

  lineBuffer += decoder.decode();
  if (lineBuffer.length > 0) {
    rawResponse += lineBuffer;
    eventLines.push(lineBuffer);
  }

  if (!sawDone && eventLines.length > 0) {
    const trailing = await processSseEvent(eventLines, parser, emitUpdate);
    emittedAnyUpdate ||= trailing.emittedAnyUpdate;
    sawDone ||= trailing.sawDone;
  }

  try {
    const finalized = parser.finish();
    scheduleDiagnosticEntry({
      timestamp: new Date().toISOString(),
      mode: "stream",
      endpoint,
      model,
      targetLanguage,
      segmentCount: segments.length,
      segments: diagnosticSegments(segments),
      rawResponse,
      parsedItems: finalized.items
    });
    if (finalized.missingIds.length > 0) {
      return {
        ok: false,
        items: finalized.items,
        emittedAnyUpdate,
        error: streamError(streamReadError, `模型流式返回缺失 ${finalized.missingIds.length} 个片段。`)
      };
    }
    return { ok: true, items: finalized.items, emittedAnyUpdate };
  } catch {
    const partialItems = parser.getCompletedItems();
    scheduleDiagnosticEntry({
      timestamp: new Date().toISOString(),
      mode: "stream",
      endpoint,
      model,
      targetLanguage,
      segmentCount: segments.length,
      segments: diagnosticSegments(segments),
      rawResponse,
      parsedItems: partialItems,
      error: "stream ended before all items were closed"
    });
    if (emittedAnyUpdate) {
      return {
        ok: false,
        items: partialItems,
        emittedAnyUpdate,
        error: streamError(streamReadError)
      };
    }
    const fallback = await handleJsonResponseFromText(await safeResponseText(response), segments, options);
    scheduleDiagnosticEntry({
      timestamp: new Date().toISOString(),
      mode: "stream",
      endpoint,
      model,
      targetLanguage,
      segmentCount: segments.length,
      segments: diagnosticSegments(segments),
      rawResponse,
      parsedItems: fallback.ok ? fallback.items : undefined,
      error: fallback.ok ? undefined : fallback.error?.message ?? "unknown error"
    });
    return { ...fallback, emittedAnyUpdate };
  }
}

function streamError(error: unknown, message?: string): TranslationError {
  if (error instanceof DOMException && error.name === "AbortError") {
    return createTranslationError("API_TIMEOUT", true, message);
  }
  return createTranslationError("API_BAD_RESPONSE", true, message);
}

async function consumeSseLines(
  source: string,
  existingEventLines: string[],
  parser: ReturnType<typeof createStreamingTranslationParser>,
  emitUpdate: (item: StreamingTranslationItem) => Promise<void>
): Promise<{ lineBuffer: string; eventLines: string[]; emittedAnyUpdate: boolean; sawDone: boolean }> {
  let lineBuffer = source;
  let eventLines = existingEventLines.slice();
  let emittedAnyUpdate = false;
  let sawDone = false;

  while (true) {
    const newlineMatch = lineBuffer.match(/\r?\n/);
    if (!newlineMatch?.index && newlineMatch?.index !== 0) break;
    const newlineIndex = newlineMatch.index;
    const line = lineBuffer.slice(0, newlineIndex);
    lineBuffer = lineBuffer.slice(newlineIndex + newlineMatch[0].length);
    if (line === "") {
      const processed = await processSseEvent(eventLines, parser, emitUpdate);
      emittedAnyUpdate ||= processed.emittedAnyUpdate;
      sawDone ||= processed.sawDone;
      eventLines = [];
      if (sawDone) break;
      continue;
    }
    eventLines.push(line);
  }

  return { lineBuffer, eventLines, emittedAnyUpdate, sawDone };
}

async function processSseEvent(
  lines: string[],
  parser: ReturnType<typeof createStreamingTranslationParser>,
  emitUpdate: (item: StreamingTranslationItem) => Promise<void>
): Promise<{ emittedAnyUpdate: boolean; sawDone: boolean }> {
  if (lines.length === 0) return { emittedAnyUpdate: false, sawDone: false };
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return { emittedAnyUpdate: false, sawDone: false };
  if (data === "[DONE]") return { emittedAnyUpdate: false, sawDone: true };

  const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string | null } }> };
  const content = parsed.choices?.[0]?.delta?.content;
  if (typeof content !== "string" || content.length === 0) {
    return { emittedAnyUpdate: false, sawDone: false };
  }

  const updates = parser.push(content);
  for (const update of updates) {
    await emitUpdate(update);
  }
  return { emittedAnyUpdate: updates.length > 0, sawDone: false };
}

async function handleJsonResponse(
  response: Response,
  segments: TranslationSegment[],
  options: StreamTranslateOptions
): Promise<{ ok: boolean; items: TranslationItem[]; error?: TranslationError }> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return parseMessageContent(data.choices?.[0]?.message?.content, segments, options);
  }

  return handleJsonResponseFromText(await safeResponseText(response), segments, options);
}

async function handleJsonResponseFromText(
  raw: string,
  segments: TranslationSegment[],
  options: StreamTranslateOptions
): Promise<{ ok: boolean; items: TranslationItem[]; error?: TranslationError }> {
  try {
    const parsed = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
    return parseMessageContent(parsed.choices?.[0]?.message?.content, segments, options);
  } catch {
    return parseMessageContent(raw, segments, options);
  }
}

function parseMessageContent(
  content: string | undefined,
  segments: TranslationSegment[],
  options: StreamTranslateOptions
): { ok: boolean; items: TranslationItem[]; error?: TranslationError } {
  if (typeof content !== "string") {
    return { ok: false, items: [], error: createTranslationError("API_BAD_RESPONSE", true) };
  }

  try {
    return { ok: true, items: parseTranslationResponse(content).items };
  } catch {
    if (options.allowPlainTextFallback && segments.length === 1 && isPlausiblePlainTextTranslation(content)) {
      return { ok: true, items: [{ id: segments[0]!.id, text: content.trim() }] };
    }
    return { ok: false, items: [], error: createTranslationError("API_BAD_RESPONSE", true, badResponseMessage(content)) };
  }
}

function isEventStream(response: Response): boolean {
  const contentType = response.headers.get("Content-Type") ?? "";
  return contentType.includes("text/event-stream");
}

function isPlausiblePlainTextTranslation(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("```")) return false;
  return trimmed.length <= 500;
}

function badResponseMessage(content: string): string {
  return `模型返回格式异常：实际返回「${preview(content)}」。请确认模型支持按提示返回 JSON 对象。`;
}

function preview(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 160);
}

async function withRetries(
  fn: () => Promise<{
    ok: boolean;
    emittedAnyUpdate: boolean;
    items: TranslationItem[];
    error?: TranslationError;
  }>
): Promise<StreamTranslateResult> {
  let lastError: TranslationError | undefined;
  let lastItems: TranslationItem[] = [];

  for (let attempt = 0; attempt <= 2; attempt += 1) {
    const result = await fn();
    if (result.ok) {
      return { ok: true, items: result.items };
    }
    lastError = result.error;
    lastItems = result.items;
    if (result.emittedAnyUpdate) break;
    if (!result.error?.retryable) break;
    if (attempt < 2) await delay(300 * (attempt + 1));
  }

  return {
    ok: false,
    items: lastItems,
    error: lastError ?? createTranslationError("NETWORK_ERROR", true)
  };
}

function errorFromStatus(status: number, detail: string, apiKey: string): TranslationError {
  const safeDetail = detail.replaceAll(apiKey, maskApiKey(apiKey)).slice(0, 200);
  if (status === 401 || status === 403) {
    return createTranslationError("API_AUTH_FAILED", false, `API Key 无效或无权限。${safeDetail ? ` ${safeDetail}` : ""}`);
  }
  if (status === 429) {
    return createTranslationError("API_RATE_LIMITED", true);
  }
  if (status >= 500) {
    return createTranslationError("NETWORK_ERROR", true);
  }
  return createTranslationError("API_BAD_RESPONSE", false);
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
