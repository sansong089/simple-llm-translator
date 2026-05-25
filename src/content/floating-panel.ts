import type { ShowFloatingPanelMessage } from "../shared/messages";

let panel: HTMLDivElement | undefined;
let lastSelectionRect: DOMRect | undefined;
let outsideListener: ((event: MouseEvent) => void) | undefined;

export function rememberSelectionRect(): void {
  const rect = getSelectionRect();
  if (rect) lastSelectionRect = rect;
}

export function showFloatingPanel(message: ShowFloatingPanelMessage): void {
  if (!panel) panel = createPanel();
  const rect = getSelectionRect() ?? lastSelectionRect;
  if (rect) positionPanel(panel, rect);
  else positionFallback(panel);

  panel.textContent = "";
  const title = document.createElement("div");
  title.className = "llm-translator-title";
  title.textContent = titleText(message);
  panel.appendChild(title);

  const body = document.createElement("div");
  body.className = "llm-translator-body";
  body.textContent = bodyText(message);
  panel.appendChild(body);

  document.documentElement.appendChild(panel);
  installOutsideListener();
}

function titleText(message: ShowFloatingPanelMessage): string {
  if (message.status === "loading" || message.status === "streaming") return "翻译中...";
  if (message.status === "error") return "翻译失败";
  return "翻译结果";
}

function bodyText(message: ShowFloatingPanelMessage): string {
  if (message.status === "success") return message.translatedText ?? "";
  if (message.status === "streaming") return message.partialText ?? "正在请求模型...";
  if (message.status === "error") return message.errorMessage ?? "正在请求模型...";
  return "正在请求模型...";
}

function createPanel(): HTMLDivElement {
  const element = document.createElement("div");
  element.id = "llm-web-translator-floating-panel";
  element.style.position = "fixed";
  element.style.zIndex = "2147483647";
  element.style.maxWidth = "420px";
  element.style.minWidth = "220px";
  element.style.padding = "12px";
  element.style.border = "1px solid #d0d7de";
  element.style.borderRadius = "8px";
  element.style.background = "#ffffff";
  element.style.color = "#1f2328";
  element.style.boxShadow = "0 8px 30px rgba(0, 0, 0, 0.18)";
  element.style.font = "14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  element.style.whiteSpace = "pre-wrap";
  return element;
}

function getSelectionRect(): DOMRect | undefined {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return undefined;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return undefined;
  return rect;
}

function positionPanel(element: HTMLElement, rect: DOMRect): void {
  const top = Math.min(window.innerHeight - 80, Math.max(12, rect.bottom + 8));
  const left = Math.min(window.innerWidth - 240, Math.max(12, rect.left));
  element.style.top = `${top}px`;
  element.style.left = `${left}px`;
}

function positionFallback(element: HTMLElement): void {
  element.style.top = "16px";
  element.style.right = "16px";
  element.style.left = "";
}

function installOutsideListener(): void {
  if (outsideListener) return;
  outsideListener = (event: MouseEvent) => {
    if (panel && event.target instanceof Node && !panel.contains(event.target)) {
      panel.remove();
      document.removeEventListener("mousedown", outsideListener!, true);
      outsideListener = undefined;
    }
  };
  setTimeout(() => document.addEventListener("mousedown", outsideListener!, true), 0);
}
