import type { TranslationItem, TranslationSegment } from "../shared/types";

const DIAGNOSTIC_KEY = "translationDiagnosticLog";
const MAX_ENTRIES = 12;
let appendQueue = Promise.resolve();

export interface TranslationDiagnosticEntry {
  timestamp: string;
  mode: "stream" | "json";
  endpoint: string;
  model: string;
  targetLanguage: string;
  segmentCount: number;
  segments: Array<{
    id: string;
    kind: TranslationSegment["kind"];
    text: string;
    context?: TranslationSegment["context"];
  }>;
  rawResponse?: string;
  parsedItems?: TranslationItem[];
  error?: string;
}

export async function appendDiagnosticEntry(entry: TranslationDiagnosticEntry): Promise<void> {
  if (!globalThis.chrome?.storage?.local) return;
  appendQueue = appendQueue
    .catch(() => undefined)
    .then(async () => {
      const data = await chrome.storage.local.get(DIAGNOSTIC_KEY);
      const current = Array.isArray(data[DIAGNOSTIC_KEY]) ? (data[DIAGNOSTIC_KEY] as TranslationDiagnosticEntry[]) : [];
      const next = [entry, ...current].slice(0, MAX_ENTRIES);
      await chrome.storage.local.set({ [DIAGNOSTIC_KEY]: next });
    });
  await appendQueue.catch(() => undefined);
}

export async function clearDiagnosticLog(): Promise<void> {
  appendQueue = Promise.resolve();
  if (!globalThis.chrome?.storage?.local) return;
  await chrome.storage.local.remove(DIAGNOSTIC_KEY);
}
