import type { GetTabStatusMessage, StartPageTranslationMessage, StopPageTranslationMessage, TabStatusMessage } from "../shared/messages";
import type { TabStatus } from "../shared/types";

const configuredEl = document.querySelector<HTMLElement>("#configured")!;
const statusEl = document.querySelector<HTMLElement>("#page-status")!;
const messageEl = document.querySelector<HTMLElement>("#message")!;
const translateButton = document.querySelector<HTMLButtonElement>("#translate")!;
const stopButton = document.querySelector<HTMLButtonElement>("#stop")!;
const optionsButton = document.querySelector<HTMLButtonElement>("#options")!;

let activeTabId: number | undefined;
void refresh();

translateButton.addEventListener("click", () => void translatePage());
stopButton.addEventListener("click", () => void stopTranslation());
optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

async function refresh(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;
  if (!activeTabId) {
    renderUnavailable();
    return;
  }
  try {
    const request: GetTabStatusMessage = { type: "GET_TAB_STATUS", tabId: activeTabId };
    const response = (await chrome.runtime.sendMessage(request)) as TabStatusMessage;
    render(response.status);
  } catch {
    renderUnavailable();
  }
}

async function translatePage(): Promise<void> {
  if (!activeTabId) return;
  const message: StartPageTranslationMessage = { type: "START_PAGE_TRANSLATION", tabId: activeTabId };
  const result = await chrome.runtime.sendMessage(message);
  messageEl.textContent = result?.ok ? "已开始翻译。" : "无法启动翻译，请检查配置或页面权限。";
  await refresh();
}

async function stopTranslation(): Promise<void> {
  if (!activeTabId) return;
  const message: StopPageTranslationMessage = { type: "STOP_PAGE_TRANSLATION", tabId: activeTabId };
  await chrome.runtime.sendMessage(message);
  messageEl.textContent = "已停止当前页面翻译。";
  await refresh();
}

function render(status: TabStatus): void {
  configuredEl.textContent = status.configured ? "已配置" : "未配置";
  statusEl.textContent = labelForStatus(status.status);
  translateButton.disabled = !status.configured || !status.pageAvailable;
  stopButton.disabled = status.status !== "running";
}

function renderUnavailable(): void {
  configuredEl.textContent = "未知";
  statusEl.textContent = "当前页面不可用";
  translateButton.disabled = true;
  stopButton.disabled = true;
}

function labelForStatus(status: TabStatus["status"]): string {
  switch (status) {
    case "running": return "翻译中";
    case "stopped": return "已停止";
    case "unavailable": return "当前页面不可用";
    default: return "未启动";
  }
}
