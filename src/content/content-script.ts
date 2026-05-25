import type {
  ContentStartPageTranslationMessage,
  ContentStopPageTranslationMessage,
  Message,
  QueryRunnerStatusMessage,
  ShowFloatingPanelMessage,
  TranslateBatchStreamChunkMessage,
  TranslateBatchStreamDoneMessage
} from "../shared/messages";
import { BUILD_ID } from "../shared/build-info";
import { rememberSelectionRect, showFloatingPanel } from "./floating-panel";
import { TranslationRunner } from "./translation-runner";

const runner = new TranslationRunner();
(window as unknown as { __LLM_TRANSLATOR_LOADED?: boolean }).__LLM_TRANSLATOR_LOADED = true;

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  switch (message.type) {
    case "CONTENT_START_PAGE_TRANSLATION":
      handleStart(message);
      sendResponse({ ok: true });
      return true;
    case "CONTENT_STOP_PAGE_TRANSLATION":
      handleStop(message);
      sendResponse({ ok: true });
      return true;
    case "SHOW_FLOATING_PANEL":
      handleFloatingPanel(message);
      sendResponse({ ok: true });
      return true;
    case "TRANSLATE_BATCH_STREAM_CHUNK":
      handleBatchStreamChunk(message);
      sendResponse({ ok: true });
      return true;
    case "TRANSLATE_BATCH_STREAM_DONE":
      handleBatchStreamDone(message);
      sendResponse({ ok: true });
      return true;
    case "QUERY_RUNNER_STATUS":
      sendResponse(handleQueryStatus(message));
      return true;
    case "GET_BUILD_INFO":
      sendResponse({ ok: true, buildId: BUILD_ID });
      return true;
    default:
      return false;
  }
});

document.addEventListener("contextmenu", () => {
  rememberSelectionRect();
}, true);

function handleStart(message: ContentStartPageTranslationMessage): void {
  runner.start(message.runId, message.frameId, message.settingsView);
}

function handleStop(_message: ContentStopPageTranslationMessage): void {
  runner.stop();
}

function handleFloatingPanel(message: ShowFloatingPanelMessage): void {
  if (message.status === "loading") rememberSelectionRect();
  showFloatingPanel(message);
}

function handleBatchStreamChunk(message: TranslateBatchStreamChunkMessage): void {
  runner.handleBatchStreamChunk(message);
}

function handleBatchStreamDone(message: TranslateBatchStreamDoneMessage): void {
  runner.handleBatchStreamDone(message);
}

function handleQueryStatus(_message: QueryRunnerStatusMessage) {
  return runner.getStatus();
}
