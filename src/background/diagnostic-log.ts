import type { TranslationItem, TranslationSegment } from "../shared/types";

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
  void entry;
}

export async function clearDiagnosticLog(): Promise<void> {
  return;
}
