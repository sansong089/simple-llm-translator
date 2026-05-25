import { DEFAULT_MODEL_CONFIG, DEFAULT_SETTINGS } from "../shared/constants";
import type { ModelApiConfig, Settings, SettingsView } from "../shared/types";

const SETTINGS_KEY = "settings";

export async function getSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(data[SETTINGS_KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalizeSettings(settings) });
}

export function validateSettings(settings: Settings): string[] {
  const errors: string[] = [];
  if (settings.modelConfigs.length === 0) errors.push("至少需要配置一个模型接口");
  settings.modelConfigs.forEach((config, index) => {
    validateModelConfig(config).forEach((error) => errors.push(`接口 ${index + 1}：${error}`));
  });
  const selected = getSelectedModelConfig(settings);
  if (!selected) errors.push("必须选择一个有效的模型接口");
  if (!settings.targetLanguage.trim()) errors.push("目标语言不能为空");
  if (settings.requestTimeoutMs <= 0) errors.push("请求超时时间必须大于 0");
  if (settings.maxCharsPerBatch <= 0) errors.push("单批最大字符数必须大于 0");
  return errors;
}

export function isConfigured(settings: Settings): boolean {
  return validateSettings(settings).length === 0;
}

export function toSettingsView(settings: Settings): SettingsView {
  return {
    targetLanguage: settings.targetLanguage,
    maxCharsPerBatch: settings.maxCharsPerBatch
  };
}

function normalizeSettings(value: unknown): Settings {
  const partial = typeof value === "object" && value ? (value as Partial<Settings>) : {};
  const legacyModelConfig = normalizeLegacyModelConfig(partial as LegacySettingsShape);
  const modelConfigs = normalizeModelConfigs(partial.modelConfigs, legacyModelConfig);
  const selectedModelConfigId = normalizeSelectedModelConfigId(partial.selectedModelConfigId, modelConfigs);
  return {
    modelConfigs,
    selectedModelConfigId,
    targetLanguage: String(partial.targetLanguage ?? DEFAULT_SETTINGS.targetLanguage),
    requestTimeoutMs: Number(partial.requestTimeoutMs ?? DEFAULT_SETTINGS.requestTimeoutMs),
    maxCharsPerBatch: Number(partial.maxCharsPerBatch ?? DEFAULT_SETTINGS.maxCharsPerBatch)
  };
}

export function getSelectedModelConfig(settings: Settings): ModelApiConfig | undefined {
  return settings.modelConfigs.find((config) => config.id === settings.selectedModelConfigId);
}

function validateModelConfig(config: ModelApiConfig): string[] {
  const errors: string[] = [];
  if (!config.name.trim()) errors.push("接口名称不能为空");
  if (!config.baseUrl.trim()) errors.push("Base URL 不能为空");
  if (!config.apiKey.trim()) errors.push("API Key 不能为空");
  if (!config.model.trim()) errors.push("Model 不能为空");
  return errors;
}

function normalizeBaseUrl(value: string): string {
  return String(value).trim().replace(/\/+$/, "");
}

function normalizeModelConfigs(
  value: Settings["modelConfigs"] | undefined,
  legacyModelConfig: ModelApiConfig | undefined
): ModelApiConfig[] {
  const raw = Array.isArray(value) ? value : legacyModelConfig ? [legacyModelConfig] : DEFAULT_SETTINGS.modelConfigs;
  const normalized = raw.map((config, index) => normalizeModelConfig(config, index)).filter((config) => config !== null);
  return normalized.length > 0 ? normalized : [createDefaultModelConfig()];
}

function normalizeModelConfig(value: unknown, index: number): ModelApiConfig | null {
  if (!value || typeof value !== "object") return null;
  const partial = value as Partial<ModelApiConfig>;
  const id = String(partial.id ?? `config-${index + 1}`).trim() || `config-${index + 1}`;
  return {
    id,
    name: String(partial.name ?? `接口 ${index + 1}`).trim() || `接口 ${index + 1}`,
    baseUrl: normalizeBaseUrl(String(partial.baseUrl ?? DEFAULT_MODEL_CONFIG.baseUrl)),
    apiKey: String(partial.apiKey ?? DEFAULT_MODEL_CONFIG.apiKey),
    model: String(partial.model ?? DEFAULT_MODEL_CONFIG.model),
    jsonOutputMode: Boolean(partial.jsonOutputMode ?? DEFAULT_MODEL_CONFIG.jsonOutputMode)
  };
}

function normalizeSelectedModelConfigId(value: string | undefined, modelConfigs: ModelApiConfig[]): string {
  const requested = String(value ?? "").trim();
  if (requested && modelConfigs.some((config) => config.id === requested)) return requested;
  return modelConfigs[0]!.id;
}

function createDefaultModelConfig(): ModelApiConfig {
  return {
    ...DEFAULT_MODEL_CONFIG,
    id: DEFAULT_MODEL_CONFIG.id
  };
}

interface LegacySettingsShape {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  jsonOutputMode?: boolean;
}

function normalizeLegacyModelConfig(value: LegacySettingsShape): ModelApiConfig | undefined {
  const hasLegacyFields = [value.baseUrl, value.apiKey, value.model].some((item) => typeof item === "string");
  if (!hasLegacyFields) return undefined;
  return {
    id: DEFAULT_MODEL_CONFIG.id,
    name: DEFAULT_MODEL_CONFIG.name,
    baseUrl: normalizeBaseUrl(String(value.baseUrl ?? DEFAULT_MODEL_CONFIG.baseUrl)),
    apiKey: String(value.apiKey ?? DEFAULT_MODEL_CONFIG.apiKey),
    model: String(value.model ?? DEFAULT_MODEL_CONFIG.model),
    jsonOutputMode: Boolean(value.jsonOutputMode ?? DEFAULT_MODEL_CONFIG.jsonOutputMode)
  };
}
