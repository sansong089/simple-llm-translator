import { createTranslationError } from "../shared/errors";
import type {
  Settings,
  StreamingTranslationItem,
  TranslationError,
  TranslationItem,
  TranslationSegment
} from "../shared/types";
import { streamTranslateSegments, translateSegments } from "./openai-client";

export async function translateBatch(
  settings: Settings,
  targetLanguage: string,
  segments: TranslationSegment[]
): Promise<{ ok: true; items: TranslationItem[] } | { ok: false; error: TranslationError }> {
  if (segments.length === 0) return { ok: true, items: [] };
  const chars = segments.reduce((sum, segment) => sum + segment.text.length, 0);
  if (chars > settings.maxCharsPerBatch) {
    return { ok: false, error: createTranslationError("API_BAD_RESPONSE", false, "批次字符数超过限制。") };
  }
  return translateSegments(settings, targetLanguage, segments);
}

export async function translateSingleText(
  settings: Settings,
  targetLanguage: string,
  text: string,
  options: { allowPlainTextFallback?: boolean } = {}
): Promise<{ ok: true; text: string } | { ok: false; error: TranslationError }> {
  const result = await translateSegments(settings, targetLanguage, [{ id: "selection", kind: "text", text }], options);
  if (!result.ok) return result;
  const item = result.items.find((candidate) => candidate.id === "selection");
  if (!item) return { ok: false, error: createTranslationError("API_BAD_RESPONSE", true) };
  return { ok: true, text: item.text };
}

export async function streamTranslateBatch(
  settings: Settings,
  targetLanguage: string,
  segments: TranslationSegment[],
  onUpdate: (item: StreamingTranslationItem) => void | Promise<void>
): Promise<{ ok: true; completedIds: string[] } | { ok: false; completedIds: string[]; error: TranslationError }> {
  const validation = validateBatch(settings, segments);
  if (validation) {
    return { ok: false, completedIds: [], error: validation };
  }

  const completedIds = new Set<string>();
  const result = await streamTranslateSegments(settings, targetLanguage, segments, {
    onUpdate: async (item) => {
      if (item.done) completedIds.add(item.id);
      await onUpdate(item);
    }
  });

  if (result.ok) {
    return { ok: true, completedIds: Array.from(completedIds) };
  }
  return {
    ok: false,
    completedIds: Array.from(completedIds),
    error: result.error ?? createTranslationError("NETWORK_ERROR", true)
  };
}

export async function streamTranslateSingleText(
  settings: Settings,
  targetLanguage: string,
  text: string,
  onUpdate: (item: StreamingTranslationItem) => void | Promise<void>,
  options: { allowPlainTextFallback?: boolean } = {}
): Promise<{ ok: true; text: string } | { ok: false; error: TranslationError }> {
  let finalText = "";
  const result = await streamTranslateSegments(settings, targetLanguage, [{ id: "selection", kind: "text", text }], {
    allowPlainTextFallback: options.allowPlainTextFallback,
    onUpdate: async (item) => {
      if (item.id === "selection") {
        finalText = item.text;
        await onUpdate(item);
      }
    }
  });

  if (!result.ok) {
    return { ok: false, error: result.error ?? createTranslationError("NETWORK_ERROR", true) };
  }
  if (!finalText) {
    const item = result.items.find((candidate) => candidate.id === "selection");
    if (!item) return { ok: false, error: createTranslationError("API_BAD_RESPONSE", true) };
    finalText = item.text;
  }
  return { ok: true, text: finalText };
}

function validateBatch(settings: Settings, segments: TranslationSegment[]): TranslationError | undefined {
  if (segments.length === 0) return undefined;
  const chars = segments.reduce((sum, segment) => sum + segment.text.length, 0);
  if (chars > settings.maxCharsPerBatch) {
    return createTranslationError("API_BAD_RESPONSE", false, "批次字符数超过限制。");
  }
  return undefined;
}
