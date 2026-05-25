import type {
  RunnerStatus,
  SettingsView,
  StreamingTranslationItem,
  TabStatus,
  TranslationError,
  TranslationItem,
  TranslationSegment
} from "./types";

export interface StartPageTranslationMessage {
  type: "START_PAGE_TRANSLATION";
  tabId: number;
}

export interface ContentStartPageTranslationMessage {
  type: "CONTENT_START_PAGE_TRANSLATION";
  runId: string;
  frameId: number;
  settingsView: SettingsView;
}

export interface StopPageTranslationMessage {
  type: "STOP_PAGE_TRANSLATION";
  tabId: number;
  runId?: string;
}

export interface ContentStopPageTranslationMessage {
  type: "CONTENT_STOP_PAGE_TRANSLATION";
  runId?: string;
}

export interface TranslateSelectionMessage {
  type: "TRANSLATE_SELECTION";
  tabId: number;
  frameId: number;
  selectionText: string;
}

export interface TranslateBatchMessage {
  type: "TRANSLATE_BATCH";
  tabId: number;
  frameId: number;
  runId: string;
  batchId: string;
  targetLanguage: string;
  segments: TranslationSegment[];
}

export interface TranslateBatchAcceptedResponse {
  ok: boolean;
  accepted?: boolean;
  error?: TranslationError;
}

export interface TranslateBatchResultMessage {
  type: "TRANSLATE_BATCH_RESULT";
  frameId: number;
  runId: string;
  ok: boolean;
  items?: TranslationItem[];
  error?: TranslationError;
}

export interface TranslateBatchStreamChunkMessage {
  type: "TRANSLATE_BATCH_STREAM_CHUNK";
  frameId: number;
  runId: string;
  batchId: string;
  items: StreamingTranslationItem[];
}

export interface TranslateBatchStreamDoneMessage {
  type: "TRANSLATE_BATCH_STREAM_DONE";
  frameId: number;
  runId: string;
  batchId: string;
  ok: boolean;
  completedIds: string[];
  error?: TranslationError;
}

export interface GetTabStatusMessage {
  type: "GET_TAB_STATUS";
  tabId: number;
}

export interface TabStatusMessage {
  type: "TAB_STATUS";
  status: TabStatus;
}

export interface QueryRunnerStatusMessage {
  type: "QUERY_RUNNER_STATUS";
}

export interface GetBuildInfoMessage {
  type: "GET_BUILD_INFO";
}

export interface BuildInfoResponse {
  ok: true;
  buildId: string;
}

export interface RunnerStatusMessage {
  type: "RUNNER_STATUS";
  status: RunnerStatus;
}

export interface ShowFloatingPanelMessage {
  type: "SHOW_FLOATING_PANEL";
  status: "loading" | "streaming" | "success" | "error";
  sourceText?: string;
  translatedText?: string;
  partialText?: string;
  errorMessage?: string;
}

export interface SettingsUpdatedMessage {
  type: "SETTINGS_UPDATED";
}

export type Message =
  | StartPageTranslationMessage
  | ContentStartPageTranslationMessage
  | StopPageTranslationMessage
  | ContentStopPageTranslationMessage
  | TranslateSelectionMessage
  | TranslateBatchMessage
  | TranslateBatchResultMessage
  | TranslateBatchStreamChunkMessage
  | TranslateBatchStreamDoneMessage
  | GetTabStatusMessage
  | TabStatusMessage
  | QueryRunnerStatusMessage
  | GetBuildInfoMessage
  | RunnerStatusMessage
  | ShowFloatingPanelMessage
  | SettingsUpdatedMessage;
