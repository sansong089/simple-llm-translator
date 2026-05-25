import type { StreamingTranslationItem, TranslationItem } from "./types";

const STREAM_OPEN_PREFIX = "[[ITEM:";
const STREAM_OPEN_SUFFIX = "]]";
const STREAM_CLOSE_MARKER = "[[/ITEM]]";

export interface ParsedTranslationResponse {
  ok: boolean;
  items: TranslationItem[];
}

export interface StreamFinalizeResult {
  items: TranslationItem[];
  missingIds: string[];
}

export function buildUserPayload(targetLanguage: string, segments: Array<{ id: string; kind: string; text: string }>): string {
  return JSON.stringify({ targetLanguage, segments });
}

export function buildStreamingProtocolPrompt(): string {
  return [
    "使用流式输出时，不要返回 JSON。",
    `按输入 segments 的顺序输出，每个片段都必须严格使用 ${STREAM_OPEN_PREFIX}<id>${STREAM_OPEN_SUFFIX}译文${STREAM_CLOSE_MARKER} 包裹。`,
    `示例：${STREAM_OPEN_PREFIX}n1${STREAM_OPEN_SUFFIX}你好${STREAM_CLOSE_MARKER}${STREAM_OPEN_PREFIX}n2${STREAM_OPEN_SUFFIX}世界${STREAM_CLOSE_MARKER}`,
    "除这些标记和译文外，不要输出任何额外文字、说明、Markdown 或代码块。"
  ].join("\n");
}

export function parseTranslationResponse(raw: string): ParsedTranslationResponse {
  const jsonText = extractJson(raw);
  const parsed: unknown = JSON.parse(jsonText);
  if (!isTranslationResponse(parsed)) {
    throw new Error("Invalid translation response schema");
  }
  return { ok: true, items: parsed.items };
}

export function createStreamingTranslationParser(expectedIds: string[]): StreamingTranslationParser {
  return new StreamingTranslationParser(expectedIds);
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  return trimmed;
}

function isTranslationResponse(value: unknown): value is { items: TranslationItem[] } {
  if (!value || typeof value !== "object") return false;
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return false;
  return items.every((item) => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as { id?: unknown; text?: unknown };
    return typeof candidate.id === "string" && typeof candidate.text === "string";
  });
}

class StreamingTranslationParser {
  private readonly expectedIds: Set<string>;
  private readonly completed = new Map<string, string>();
  private buffer = "";
  private currentId: string | undefined;
  private currentText = "";
  private currentKnown = false;

  constructor(expectedIds: string[]) {
    this.expectedIds = new Set(expectedIds);
  }

  push(chunk: string): StreamingTranslationItem[] {
    if (!chunk) return [];
    this.buffer += chunk;
    const updates: StreamingTranslationItem[] = [];

    while (true) {
      if (!this.currentId) {
        const opened = this.tryOpenItem();
        if (!opened) break;
        continue;
      }

      const closeIndex = this.buffer.indexOf(STREAM_CLOSE_MARKER);
      if (closeIndex >= 0) {
        const textPart = this.buffer.slice(0, closeIndex);
        this.currentText += textPart;
        if (this.currentKnown) {
          updates.push({ id: this.currentId, text: this.currentText, done: true });
          this.completed.set(this.currentId, this.currentText);
        }
        this.buffer = this.buffer.slice(closeIndex + STREAM_CLOSE_MARKER.length);
        this.currentId = undefined;
        this.currentText = "";
        this.currentKnown = false;
        continue;
      }

      const safeLength = this.buffer.length - (STREAM_CLOSE_MARKER.length - 1);
      if (safeLength <= 0) break;
      const textPart = this.buffer.slice(0, safeLength);
      this.currentText += textPart;
      this.buffer = this.buffer.slice(safeLength);
      if (this.currentKnown) {
        updates.push({ id: this.currentId, text: this.currentText, done: false });
      }
      break;
    }

    return dedupeUpdates(updates);
  }

  finish(): StreamFinalizeResult {
    if (this.currentId) {
      throw new Error(`Streaming item ${this.currentId} is not closed.`);
    }
    const items = Array.from(this.completed, ([id, text]) => ({ id, text }));
    const missingIds = Array.from(this.expectedIds).filter((id) => !this.completed.has(id));
    return { items, missingIds };
  }

  getCompletedItems(): TranslationItem[] {
    return Array.from(this.completed, ([id, text]) => ({ id, text }));
  }

  private tryOpenItem(): boolean {
    const openIndex = this.buffer.indexOf(STREAM_OPEN_PREFIX);
    if (openIndex < 0) {
      this.buffer = keepPossiblePrefix(this.buffer, STREAM_OPEN_PREFIX);
      return false;
    }

    if (openIndex > 0) {
      this.buffer = this.buffer.slice(openIndex);
    }

    const suffixIndex = this.buffer.indexOf(STREAM_OPEN_SUFFIX, STREAM_OPEN_PREFIX.length);
    if (suffixIndex < 0) return false;

    const id = this.buffer.slice(STREAM_OPEN_PREFIX.length, suffixIndex).trim();
    this.buffer = this.buffer.slice(suffixIndex + STREAM_OPEN_SUFFIX.length);
    this.currentId = id;
    this.currentText = "";
    this.currentKnown = this.expectedIds.has(id) && !this.completed.has(id);
    return true;
  }
}

function keepPossiblePrefix(value: string, prefix: string): string {
  const maxLength = prefix.length - 1;
  return value.slice(-maxLength);
}

function dedupeUpdates(updates: StreamingTranslationItem[]): StreamingTranslationItem[] {
  const latest = new Map<string, StreamingTranslationItem>();
  for (const update of updates) {
    latest.set(update.id, update);
  }
  return Array.from(latest.values());
}
