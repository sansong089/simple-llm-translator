import { DEFAULT_MODEL_CONFIG, DEFAULT_SETTINGS } from "../shared/constants";
import type { ModelApiConfig, Settings } from "../shared/types";
import { getSettings, saveSettings, validateSettings } from "../background/settings-store";
import { translateSingleText } from "../background/translation-service";

const form = document.querySelector<HTMLFormElement>("#settings-form")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const modelConfigsEl = document.querySelector<HTMLElement>("#modelConfigs")!;
const modelConfigTemplate = document.querySelector<HTMLTemplateElement>("#model-config-template")!;

void load();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void save();
});

document.querySelector<HTMLButtonElement>("#test")!.addEventListener("click", () => {
  void testConnection();
});

document.querySelector<HTMLButtonElement>("#addModelConfig")!.addEventListener("click", () => {
  appendModelConfigCard(createEmptyModelConfig(), true);
});

async function load(): Promise<void> {
  fill(await getSettings());
}

async function save(): Promise<boolean> {
  const settings = read();
  const errors = validateSettings(settings);
  if (errors.length > 0) {
    setStatus(errors.join("；"), true);
    return false;
  }
  await saveSettings(settings);
  setStatus("已保存。");
  return true;
}

async function testConnection(): Promise<void> {
  if (!(await save())) return;
  setStatus("正在测试连接...");
  const settings = await getSettings();
  const result = await translateSingleText(settings, settings.targetLanguage, "Hello", { allowPlainTextFallback: true });
  setStatus(result.ok ? `测试成功：${result.text}` : result.error.message, !result.ok);
}

function fill(settings: Settings): void {
  modelConfigsEl.replaceChildren();
  settings.modelConfigs.forEach((config) => appendModelConfigCard(config, config.id === settings.selectedModelConfigId));
  if (settings.modelConfigs.length === 0) {
    appendModelConfigCard(createEmptyModelConfig(), true);
  }
  setValue("targetLanguage", settings.targetLanguage);
  setValue("requestTimeoutMs", String(settings.requestTimeoutMs));
  setValue("maxCharsPerBatch", String(settings.maxCharsPerBatch));
}

function read(): Settings {
  const modelConfigs = Array.from(modelConfigsEl.querySelectorAll<HTMLElement>(".model-config-card")).map((card, index) => ({
    id: card.dataset.configId || `config-${index + 1}`,
    name: getCardValue(card, ".model-config-name") || `接口 ${index + 1}`,
    baseUrl: getCardValue(card, ".model-config-base-url").replace(/\/+$/, ""),
    apiKey: getCardValue(card, ".model-config-api-key"),
    model: getCardValue(card, ".model-config-model"),
    jsonOutputMode: card.querySelector<HTMLInputElement>(".model-config-json-output-mode")!.checked
  }));
  const selectedInput = modelConfigsEl.querySelector<HTMLInputElement>('input[name="selectedModelConfig"]:checked');
  return {
    modelConfigs,
    selectedModelConfigId: selectedInput?.value || modelConfigs[0]?.id || DEFAULT_SETTINGS.selectedModelConfigId,
    targetLanguage: getValue("targetLanguage") || DEFAULT_SETTINGS.targetLanguage,
    requestTimeoutMs: Number(getValue("requestTimeoutMs") || DEFAULT_SETTINGS.requestTimeoutMs),
    maxCharsPerBatch: Number(getValue("maxCharsPerBatch") || DEFAULT_SETTINGS.maxCharsPerBatch)
  };
}

function appendModelConfigCard(config: ModelApiConfig, selected: boolean): void {
  const fragment = modelConfigTemplate.content.cloneNode(true) as DocumentFragment;
  const card = fragment.querySelector<HTMLElement>(".model-config-card")!;
  populateModelConfigCard(card, config, selected);
  modelConfigsEl.append(card);
  syncExpandedCards();
}

function removeModelConfigCard(card: HTMLElement): void {
  const shouldSelectNext = card.querySelector<HTMLInputElement>(".model-config-selected")!.checked;
  const cards = Array.from(modelConfigsEl.querySelectorAll<HTMLElement>(".model-config-card"));
  if (cards.length <= 1) {
    card.replaceWith(buildCardElement(createEmptyModelConfig(), true));
    syncExpandedCards();
    return;
  }
  card.remove();
  if (shouldSelectNext) {
    modelConfigsEl.querySelector<HTMLInputElement>('input[name="selectedModelConfig"]')!.checked = true;
  }
  syncExpandedCards();
}

function buildCardElement(config: ModelApiConfig, selected: boolean): HTMLElement {
  const fragment = modelConfigTemplate.content.cloneNode(true) as DocumentFragment;
  const card = fragment.querySelector<HTMLElement>(".model-config-card")!;
  populateModelConfigCard(card, config, selected);
  return card;
}

function populateModelConfigCard(card: HTMLElement, config: ModelApiConfig, selected: boolean): void {
  card.dataset.configId = config.id;
  const selectedInput = card.querySelector<HTMLInputElement>(".model-config-selected")!;
  selectedInput.value = config.id;
  selectedInput.checked = selected;
  selectedInput.addEventListener("change", () => {
    syncExpandedCards();
  });

  setCardValue(card, ".model-config-name", config.name);
  setCardValue(card, ".model-config-base-url", config.baseUrl);
  setCardValue(card, ".model-config-api-key", config.apiKey);
  setCardValue(card, ".model-config-model", config.model);
  card.querySelector<HTMLInputElement>(".model-config-json-output-mode")!.checked = config.jsonOutputMode;
  const nameInput = card.querySelector<HTMLInputElement>(".model-config-name")!;
  const baseUrlInput = card.querySelector<HTMLInputElement>(".model-config-base-url")!;
  const updateSummary = () => {
    renderCardSummary(card);
  };
  nameInput.addEventListener("input", updateSummary);
  baseUrlInput.addEventListener("input", updateSummary);
  card.querySelector<HTMLButtonElement>(".remove-model-config")!.addEventListener("click", () => {
    removeModelConfigCard(card);
  });
  renderCardSummary(card);
}

function createEmptyModelConfig(): ModelApiConfig {
  return {
    ...DEFAULT_MODEL_CONFIG,
    id: createConfigId(),
    name: "新接口"
  };
}

function createConfigId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `config-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getCardValue(card: HTMLElement, selector: string): string {
  return card.querySelector<HTMLInputElement>(selector)!.value.trim();
}

function setCardValue(card: HTMLElement, selector: string, value: string): void {
  card.querySelector<HTMLInputElement>(selector)!.value = value;
}

function renderCardSummary(card: HTMLElement): void {
  const name = getCardValue(card, ".model-config-name") || "未命名接口";
  const baseUrl = getCardValue(card, ".model-config-base-url") || "未配置 Base URL";
  card.querySelector<HTMLElement>(".model-config-summary-name")!.textContent = name;
  card.querySelector<HTMLElement>(".model-config-summary-url")!.textContent = baseUrl;
}

function syncExpandedCards(): void {
  const cards = Array.from(modelConfigsEl.querySelectorAll<HTMLElement>(".model-config-card"));
  const selectedId = modelConfigsEl.querySelector<HTMLInputElement>('input[name="selectedModelConfig"]:checked')?.value;
  for (const card of cards) {
    const expanded = card.dataset.configId === selectedId;
    card.classList.toggle("is-expanded", expanded);
    card.classList.toggle("is-collapsed", !expanded);
  }
}

function getValue(id: string): string {
  return document.querySelector<HTMLInputElement>(`#${id}`)!.value.trim();
}

function setValue(id: string, value: string): void {
  document.querySelector<HTMLInputElement>(`#${id}`)!.value = value;
}

function setStatus(message: string, error = false): void {
  statusEl.textContent = message;
  statusEl.style.color = error ? "#cf222e" : "#0969da";
}
