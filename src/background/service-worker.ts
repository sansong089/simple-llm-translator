import { FRAME_ID_TOP, MENU_IDS } from "../shared/constants";
import { createTranslationError } from "../shared/errors";
import { createRunId } from "../shared/hash";
import type {
  ContentStartPageTranslationMessage,
  ContentStopPageTranslationMessage,
  GetTabStatusMessage,
  Message,
  QueryRunnerStatusMessage,
  ShowFloatingPanelMessage,
  TabStatusMessage,
  TranslateBatchAcceptedResponse,
  TranslateBatchStreamChunkMessage,
  TranslateBatchStreamDoneMessage,
  TranslateBatchMessage
} from "../shared/messages";
import { BUILD_ID } from "../shared/build-info";
import type { RunnerStatus } from "../shared/types";
import { setupContextMenus } from "./context-menu";
import { getSettings, isConfigured, toSettingsView } from "./settings-store";
import { clearTab, ensureFrameRunning, getAggregatedStatus, isFrameRunActive, setFrameRunning, setFrameStopped } from "./tab-state";
import { streamTranslateBatch, streamTranslateSingleText } from "./translation-service";

chrome.runtime.onInstalled.addListener(setupContextMenus);
chrome.runtime.onStartup.addListener(setupContextMenus);
setupContextMenus();

chrome.tabs.onRemoved.addListener((tabId) => clearTab(tabId));

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleContextMenu(info, tab);
});

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse);
  return true;
});

async function handleContextMenu(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> {
  if (!tab?.id) return;
  const frameId = info.frameId ?? FRAME_ID_TOP;
  if (info.menuItemId === MENU_IDS.translatePage) {
    await startPageTranslation(tab.id, frameId);
    return;
  }
  if (info.menuItemId === MENU_IDS.stopPageTranslation) {
    await stopPageTranslation(tab.id, frameId);
    return;
  }
  if (info.menuItemId === MENU_IDS.translateSelection && info.selectionText) {
    await translateSelection(tab.id, frameId, info.selectionText);
  }
}

async function handleMessage(message: Message, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case "START_PAGE_TRANSLATION":
      return startPageTranslation(message.tabId, FRAME_ID_TOP);
    case "STOP_PAGE_TRANSLATION":
      return stopPageTranslation(message.tabId, FRAME_ID_TOP, message.runId);
    case "TRANSLATE_BATCH":
      return handleTranslateBatch(message, sender);
    case "GET_TAB_STATUS":
      return getTabStatus(message);
    case "GET_BUILD_INFO":
      return { ok: true, buildId: BUILD_ID };
    case "RUNNER_STATUS":
      if (sender.tab?.id) setFrameStateFromRunner(sender.tab.id, message.status);
      return { ok: true };
    default:
      return { ok: false };
  }
}

async function startPageTranslation(tabId: number, frameId: number): Promise<{ ok: boolean; error?: string }> {
  const settings = await getSettings();
  if (!isConfigured(settings)) {
    await chrome.runtime.openOptionsPage();
    return { ok: false, error: "SETTINGS_INCOMPLETE" };
  }
  if (!(await ensureContentScript(tabId, { allFrames: true }))) {
    return { ok: false, error: "UNSUPPORTED_PAGE" };
  }

  const runId = createRunId();
  setFrameRunning(tabId, frameId, runId);
  const message: ContentStartPageTranslationMessage = {
    type: "CONTENT_START_PAGE_TRANSLATION",
    runId,
    frameId,
    settingsView: toSettingsView(settings)
  };

  try {
    await chrome.tabs.sendMessage(tabId, message, { frameId });
    return { ok: true };
  } catch {
    return { ok: false, error: "UNSUPPORTED_PAGE" };
  }
}

async function stopPageTranslation(tabId: number, frameId: number, runId?: string): Promise<{ ok: boolean }> {
  setFrameStopped(tabId, frameId, runId);
  const message: ContentStopPageTranslationMessage = { type: "CONTENT_STOP_PAGE_TRANSLATION", runId };
  try {
    await chrome.tabs.sendMessage(tabId, message, { frameId });
  } catch {
    // The page may be restricted or gone. State cleanup still succeeds.
  }
  return { ok: true };
}

async function translateSelection(tabId: number, frameId: number, selectionText: string): Promise<void> {
  const settings = await getSettings();
  if (!isConfigured(settings)) {
    await chrome.runtime.openOptionsPage();
    return;
  }
  if (!(await ensureContentScript(tabId, { frameIds: [frameId] }))) {
    return;
  }

  await sendFloatingPanel(tabId, frameId, { type: "SHOW_FLOATING_PANEL", status: "loading", sourceText: selectionText });
  const result = await streamTranslateSingleText(
    settings,
    settings.targetLanguage,
    selectionText,
    async (item) => {
      await sendFloatingPanel(tabId, frameId, {
        type: "SHOW_FLOATING_PANEL",
        status: item.done ? "success" : "streaming",
        sourceText: selectionText,
        translatedText: item.done ? item.text : undefined,
        partialText: item.done ? undefined : item.text
      });
    },
    { allowPlainTextFallback: true }
  );
  if (result.ok) {
    return;
  } else {
    await sendFloatingPanel(tabId, frameId, {
      type: "SHOW_FLOATING_PANEL",
      status: "error",
      sourceText: selectionText,
      errorMessage: result.error.message
    });
  }
}

async function handleTranslateBatch(
  message: TranslateBatchMessage,
  sender: chrome.runtime.MessageSender
): Promise<TranslateBatchAcceptedResponse> {
  const settings = await getSettings();
  if (!isConfigured(settings)) {
    return {
      ok: false,
      error: createTranslationError("SETTINGS_INCOMPLETE", false)
    };
  }
  if (!sender.tab?.id) {
    return {
      ok: false,
      error: createTranslationError("UNSUPPORTED_PAGE", false, "未能识别当前页面标签。")
    };
  }
  ensureFrameRunning(sender.tab.id, message.frameId, message.runId);
  void startBatchStreaming(sender.tab.id, message, settings);
  return { ok: true, accepted: true };
}

async function getTabStatus(message: GetTabStatusMessage): Promise<TabStatusMessage> {
  const settings = await getSettings();
  const tab = await chrome.tabs.get(message.tabId).catch(() => undefined);
  const pageAvailable = isSupportedTab(tab);
  const frames = await queryRunnerStatuses(message.tabId);
  return {
    type: "TAB_STATUS",
    status: getAggregatedStatus(isConfigured(settings), pageAvailable, frames)
  };
}

async function queryRunnerStatuses(tabId: number): Promise<RunnerStatus[]> {
  const query: QueryRunnerStatusMessage = { type: "QUERY_RUNNER_STATUS" };
  try {
    const responses = await chrome.tabs.sendMessage(tabId, query);
    if (Array.isArray(responses)) return responses.filter(isRunnerStatus);
    if (isRunnerStatus(responses)) return [responses];
  } catch {
    return [];
  }
  return [];
}

function isRunnerStatus(value: unknown): value is RunnerStatus {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RunnerStatus>;
  return typeof candidate.frameId === "number" && typeof candidate.status === "string";
}

function setFrameStateFromRunner(tabId: number, status: RunnerStatus): void {
  if (status.status === "running" && status.runId) {
    setFrameRunning(tabId, status.frameId, status.runId);
  } else if (status.status === "stopped") {
    setFrameStopped(tabId, status.frameId, status.runId);
  }
}

async function sendFloatingPanel(tabId: number, frameId: number, message: ShowFloatingPanelMessage): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message, { frameId });
  } catch {
    // Ignore unsupported pages or frames for selection feedback.
  }
}

async function startBatchStreaming(
  tabId: number,
  message: TranslateBatchMessage,
  settings: Awaited<ReturnType<typeof getSettings>>
): Promise<void> {
  const result = await streamTranslateBatch(settings, message.targetLanguage, message.segments, async (item) => {
    if (!isFrameRunActive(tabId, message.frameId, message.runId)) return;
    await sendBatchChunk(tabId, {
      type: "TRANSLATE_BATCH_STREAM_CHUNK",
      frameId: message.frameId,
      runId: message.runId,
      batchId: message.batchId,
      items: [item]
    });
  });

  if (!isFrameRunActive(tabId, message.frameId, message.runId)) return;
  await sendBatchDone(tabId, {
    type: "TRANSLATE_BATCH_STREAM_DONE",
    frameId: message.frameId,
    runId: message.runId,
    batchId: message.batchId,
    ok: result.ok,
    completedIds: result.completedIds,
    error: result.ok ? undefined : result.error
  });
}

async function sendBatchChunk(tabId: number, message: TranslateBatchStreamChunkMessage): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message, { frameId: message.frameId });
  } catch {
    // Ignore frames that disappeared before stream finished.
  }
}

async function sendBatchDone(tabId: number, message: TranslateBatchStreamDoneMessage): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message, { frameId: message.frameId });
  } catch {
    // Ignore frames that disappeared before stream finished.
  }
}

async function ensureContentScript(
  tabId: number,
  target: Omit<chrome.scripting.InjectionTarget, "tabId">
): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, ...target },
      files: ["content/content-script.js"]
    });
    return true;
  } catch {
    return false;
  }
}

function isSupportedTab(tab: chrome.tabs.Tab | undefined): boolean {
  const url = tab?.url ?? "";
  return url.startsWith("http://") || url.startsWith("https://");
}
