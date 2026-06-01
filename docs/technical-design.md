# 技术设计：Simple LLM Translator

状态：草稿
日期：2026-05-21
来源方案：`C:\Users\Admin\.gstack\projects\chrome-translator\Admin-unknown-design-2026-05-21-llm-web-translation-extension.md`

## 目标

实现一个 Chrome Manifest V3 插件。翻译由用户手动触发：

- 用户右键或 popup 点击“翻译当前页面”后，插件翻译当前可见 DOM 文本并原地替换。
- 页面翻译启动后，滚动和动态插入的新 DOM 文本继续增量翻译。
- 用户右键“翻译选中文本”时，只翻译选区，并用悬浮框展示结果。
- 插件使用用户配置的 OpenAI 兼容接口，不内置厂商账号或代理服务。

V1 不做：页面打开后自动翻译、原文/译文/双语模式切换、PDF、OCR、视频字幕、Canvas 文本。

## 技术栈

- Chrome Extension Manifest V3。
- TypeScript。
- Vite 或等价轻量构建工具。
- 原生 DOM API，不引入前端框架。
- `chrome.storage.local` 存储配置。
- `chrome.contextMenus` 注册右键菜单。
- `chrome.runtime` / `chrome.tabs` 做 background、popup、content script 通信。

除构建、测试所需依赖外，第一版不引入运行时框架或复杂业务依赖。DOM 扫描、队列、缓存、请求层都用项目内模块实现。

## 构建与产物约定

Chrome 加载的是构建产物，不直接加载 `src/*.ts`。

源码目录保留 TypeScript 和 HTML/CSS 原文件，构建后输出到 `dist/`：

```text
dist/
  manifest.json
  background/service-worker.js
  content/content-script.js
  popup/popup.html
  popup/popup.js
  popup/popup.css
  options/options.html
  options/options.js
  options/options.css
```

开发时可以维护 `manifest.template.json`，构建阶段生成 `dist/manifest.json`。技术设计中的 manifest 示例表达最终产物路径，不代表源码路径。

## 目录结构

```text
chrome-translator/
  manifest.template.json
  package.json
  tsconfig.json
  vite.config.ts
  src/
    background/
      service-worker.ts
      context-menu.ts
      tab-state.ts
      openai-client.ts
      settings-store.ts
      translation-service.ts
    content/
      content-script.ts
      dom-scanner.ts
      translation-runner.ts
      node-registry.ts
      floating-panel.ts
      text-filter.ts
    popup/
      popup.html
      popup.ts
      popup.css
    options/
      options.html
      options.ts
      options.css
    shared/
      messages.ts
      types.ts
      constants.ts
      errors.ts
      hash.ts
      batch-protocol.ts
  tests/
    unit/
      batch-protocol.test.ts
      text-filter.test.ts
      tab-state.test.ts
      openai-client.test.ts
      run-id.test.ts
```

## Manifest 权限

```json
{
  "manifest_version": 3,
  "permissions": [
    "contextMenus",
    "storage",
    "activeTab",
    "scripting",
    "tabs"
  ],
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup/popup.html"
  },
  "options_page": "options/options.html"
}
```

说明：

- `activeTab` 用于用户触发后的当前页或当前 frame 注入。
- `scripting` 用于在用户操作后动态注入 `content-script.js`。
- `tabs` 用于 popup/background 判断当前 tab URL、受限页面状态，以及消息路由。

### 权限与注入策略

发布版采用最小权限策略，按用户操作动态注入 content script：

- 默认不声明静态 `content_scripts`
- 默认不声明 `host_permissions: ["<all_urls>"]`
- 用户点击 popup 或右键菜单后，通过 `activeTab` + `chrome.scripting.executeScript` 注入目标 tab 或 frame

选择这个策略的原因：

- 可以显著降低 `<all_urls>` 和全站预注入带来的商店审核风险。
- 行为上保持用户手动触发，页面打开后不自动扫描、不自动翻译、不发送页面文本。
- 仍然可以在用户触发后覆盖当前目标页面的 DOM 翻译流程。

Options 页面必须明确说明：只有用户手动触发翻译时，插件才会发送文本到用户配置的模型服务商，并提供可访问的隐私政策页面。

## 核心模块

### Background Service Worker

职责：

- 注册右键菜单。
- 读取和校验用户配置。
- 维护 tab 级翻译状态。
- 接收 popup 和 context menu 指令。
- 统一调用 OpenAI 兼容接口。
- 不把 API Key 下发给 content script。

主要模块：

- `context-menu.ts`：注册“翻译当前页面”“翻译选中文本”“停止翻译当前页面”。
- `settings-store.ts`：读写 `chrome.storage.local`。
- `tab-state.ts`：维护 tab/frame 的 run id、运行状态、停止状态。
- `openai-client.ts`：封装 OpenAI 兼容请求。
- `translation-service.ts`：批量翻译、单段翻译、错误归一化。

### Content Script

职责：

- 扫描当前视口可翻译 DOM 文本。
- 管理 MutationObserver 和运行时队列。
- 维护节点状态和文本片段 ID。
- 把译文写回 DOM。
- 展示选区翻译悬浮框。
- 停止翻译时清理 observer 和队列。

主要模块：

- `dom-scanner.ts`：扫描可翻译文本节点。
- `text-filter.ts`：过滤 URL、纯数字、代码等不应翻译的文本。
- `node-registry.ts`：维护节点 ID、原文、译文、状态。
- `translation-runner.ts`：本 frame 内的队列、批处理、run id 校验。
- `floating-panel.ts`：选区翻译浮层。

### Popup

职责：

- 显示配置是否完整。
- 显示当前 tab 是否正在翻译。
- 触发“翻译当前页面”。
- 触发“停止翻译当前页面”。
- 跳转配置页。

Popup 不直接处理翻译逻辑，只发消息给 background。

### Options

字段：

- `modelConfigs[]`
- `selectedModelConfigId`
- `targetLanguage`
- `requestTimeoutMs`
- `maxCharsPerBatch`

默认值：

- `targetLanguage`: `中文`
- `requestTimeoutMs`: `30000`
- `maxCharsPerBatch`: `12000`
- `selectedModelConfigId`: `default`

每个 `modelConfigs[n]` 都包含 `id/name/baseUrl/apiKey/model/jsonOutputMode`。`baseUrl` 表示 OpenAI 兼容 API base，必须包含版本路径，例如 `https://api.openai.com/v1` 或 `https://api.example.com/v1`。最终请求地址由 `selectedModelConfig.baseUrl + "/chat/completions"` 拼接，请求路径固定写死，不再开放配置。

保存配置时：

- 去掉 `baseUrl` 末尾 `/`。
- `baseUrl` 不自动追加 `/v1`。
- 默认组合结果为 `https://api.openai.com/v1/chat/completions`。

## 消息协议

统一定义在 `src/shared/messages.ts`。

```ts
type Message =
  | StartPageTranslationMessage
  | StopPageTranslationMessage
  | TranslateSelectionMessage
  | TranslateBatchMessage
  | TranslateBatchStreamChunkMessage
  | TranslateBatchStreamDoneMessage
  | GetTabStatusMessage
  | TabStatusMessage
  | QueryRunnerStatusMessage
  | RunnerStatusMessage
  | ShowFloatingPanelMessage;
```

### 启动页面翻译

Popup 或 context menu 发给 background：

```ts
interface StartPageTranslationMessage {
  type: "START_PAGE_TRANSLATION";
  tabId: number;
}
```

Background 生成 run id 后发给 content script：

```ts
interface ContentStartPageTranslationMessage {
  type: "CONTENT_START_PAGE_TRANSLATION";
  runId: string;
  frameId: number;
  settingsView: {
    targetLanguage: string;
    maxCharsPerBatch: number;
  };
}
```

注意：`settingsView` 不包含 API Key。

### 停止页面翻译

```ts
interface StopPageTranslationMessage {
  type: "STOP_PAGE_TRANSLATION";
  tabId: number;
  runId?: string;
}
```

Content script 收到后：

- 标记当前 run 停止。
- 停止 observer。
- 清空未发送队列。
- 忽略旧请求返回。

### 批量翻译请求

Content script 发给 background：

```ts
interface TranslateBatchMessage {
  type: "TRANSLATE_BATCH";
  tabId: number;
  frameId: number;
  runId: string;
  batchId: string;
  targetLanguage: string;
  segments: Array<{
    id: string;
    kind: "text" | "safe-html";
    text: string;
    context?: "text" | "button" | "label" | "table-cell" | "heading";
  }>;
}
```

Background 先快速确认已接收，再主动推送流式消息：

```ts
interface TranslateBatchAcceptedResponse {
  ok: boolean;
  accepted?: boolean;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

interface TranslateBatchStreamChunkMessage {
  type: "TRANSLATE_BATCH_STREAM_CHUNK";
  frameId: number;
  runId: string;
  batchId: string;
  items: Array<{
    id: string;
    text: string;
    done: boolean;
  }>;
}

interface TranslateBatchStreamDoneMessage {
  type: "TRANSLATE_BATCH_STREAM_DONE";
  frameId: number;
  runId: string;
  batchId: string;
  ok: boolean;
  completedIds: string[];
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
```

### Frame 路由

页面翻译状态按 `tabId + frameId + runId` 路由。

- 主 frame 和子 frame 各自运行 content runner。
- Background 维护 tab 级聚合状态，同时记录每个 frame 的 run 状态。
- 同源 iframe、权限允许注入的跨域 iframe 可以参与翻译。
- sandbox iframe、受限协议、Chrome Web Store、`chrome://` 等无法注入的 frame 直接跳过。
- Popup 展示 tab 级状态时，只要任一 frame 正在翻译，就显示“翻译中”。

### 选区翻译

Context menu 的 `selectionText` 由 background 接收。Background 调用模型后，再通知 content script 显示悬浮框：

```ts
interface ShowFloatingPanelMessage {
  type: "SHOW_FLOATING_PANEL";
  status: "loading" | "streaming" | "success" | "error";
  sourceText?: string;
  translatedText?: string;
  partialText?: string;
  errorMessage?: string;
}
```

选区悬浮框定位：

- 右键选区触发后，background 立即向 `info.frameId` 对应 frame 发送 `SHOW_FLOATING_PANEL(status="loading")`。
- content script 收到 loading 消息时读取 `window.getSelection()` 的 range rect，并缓存最近一次 selection rect。
- background 流式收到译文后，向同一个 `frameId` 持续发送 `streaming` 消息。
- background 调用模型完成后，再向同一个 `frameId` 发送 `success` 或 `error` 消息。
- 如果异步返回时 selection 已消失，使用缓存的 rect。
- 如果缓存也不存在，悬浮框显示在视口右上角。

选区消息必须通过 `chrome.tabs.sendMessage(tabId, message, { frameId })` 定向发送，避免 iframe 内选区结果显示到主 frame。`frameId` 只作为 Chrome 消息路由参数，不放进消息体，避免两处 frame id 不一致。

## 翻译批处理协议

模型请求必须使用稳定 ID，不依赖数组顺序。

非流式系统提示词：

```text
你是网页翻译引擎。请自动识别源语言，将每个输入片段翻译为目标语言。
只返回严格 JSON 对象，不要 Markdown，不要解释，不要额外字段。
保持 URL、代码、数字、变量名、产品名和专有名词的含义。
如果输入片段包含 HTML 标签，只翻译标签内可见文本，必须完整保留所有 HTML 标签、属性、开始标签和结束标签，不得新增、删除、重排或拆散标签。
如果某个片段不需要翻译，原样返回。
```

流式模式的系统提示词追加约束：

```text
使用流式输出时，不要返回 JSON。
按输入 segments 的顺序输出，每个片段都必须严格使用 [[ITEM:<id>]]译文[[/ITEM]] 包裹。
除这些标记和译文外，不要输出任何额外文字、说明、Markdown 或代码块。
```

流式模式的 assistant 输出示例：

```text
[[ITEM:n1]]你好，世界[[/ITEM]][[ITEM:n2]]你好，<strong>世界</strong>[[/ITEM]]
```

部分服务商支持结构化输出参数：

```json
{
  "response_format": { "type": "json_object" }
}
```

并非所有 OpenAI 兼容服务商都支持该字段。实现策略：

- 默认不强制依赖 `response_format`，避免破坏兼容性。
- 默认不发送 `response_format`。
- 仅当用户配置开启或服务商模板明确标记支持时，才附加 `response_format`。
- 无论是否使用 `response_format`，都必须做返回内容 schema 校验。
- 如果模型返回 Markdown 代码块包裹的 JSON，允许提取第一段 JSON 后解析。
- 解析结果必须是对象，且只接受 `{ items: Array<{ id: string, text: string }> }` 结构。
- 默认优先发送 `stream: true`。
- 如果服务商不支持流式并直接返回普通 JSON，则自动回退到非流式解析路径。
- 流式请求的 `requestTimeoutMs` 按空闲超时处理：只要持续收到 SSE chunk 就续期，避免长页面输出被固定墙钟时间切断。

用户消息：

```json
{
  "targetLanguage": "中文",
  "segments": [
    { "id": "n1", "kind": "text", "text": "Hello world" },
    { "id": "n2", "kind": "safe-html", "text": "Hello <strong>world</strong>" }
  ]
}
```

非流式期望返回：

```json
{
  "items": [
    { "id": "n1", "text": "你好，世界" },
    { "id": "n2", "text": "你好，<strong>世界</strong>" }
  ]
}
```

流式写回规则：

1. 纯文本片段收到增量后可以直接渐进写回。
2. `safe-html` 片段收到增量时只缓存当前全文，不立刻写回 DOM。
3. `safe-html` 只有在 `[[/ITEM]]` 完整闭合后，才执行安全校验并一次性写回。
4. 流式结束后缺失的 `id` 标记失败并保留原文。

降级规则：

1. 批量请求成功且 JSON 合法，按 ID 写回。
2. JSON 解析失败，拆成更小批次重试。
3. 小批次仍失败，拆成单片段重试。
4. 单片段仍失败，节点标记失败并保留原文。
5. 返回缺失某个 ID，该节点标记失败并保留原文。
6. 返回未知 ID，忽略。

## DOM 扫描设计

### 可翻译节点

扫描 `Text` 节点，并满足：

- 父元素可见。
- 文本 trim 后非空。
- 不在跳过标签内。
- 不在 `contenteditable` 或输入控件内。
- 文本通过过滤规则。

### 语义分组

DOM 扫描不能只把每个 `Text` 节点独立翻译。很多网页会把一句话拆成多个 inline 节点，例如：

```html
Hello <strong>world</strong>
```

V1 采用允许安全 HTML 片段的分组策略：

- 优先翻译单个 Text 节点。
- 对安全容器先做结构分析，默认只发送纯文本。
- 只有在容器内存在多个有效文本节点、翻译后可能跨内联标签重排、且本地无法安全按原节点边界回填时，才降级为 HTML 片段整体翻译。
- 安全容器必须只包含文本和纯样式 inline 标签，例如 `span`、`strong`、`em`、`b`、`i`。
- 安全容器不能包含交互元素、表单元素、媒体元素、脚本、复杂嵌套组件。
- 允许发送给模型的翻译内容中包含 HTML，但这是保底路径，不是默认路径。
- 分段时必须保证同一对 HTML 开始标签和结束标签在同一个 segment 内，不能把 `<strong>` 和 `</strong>` 拆到不同请求或不同片段。
- 简单包装容器走纯文本，例如 `<span title="effective_aniii">effective_aniii</span>` 发送给模型的是 `effective_aniii`。
- 多层样式包装但只有一个有效文本节点时也走纯文本，例如 `<strong><span>Hello world</span></strong>` 发送给模型的是 `Hello world`。
- 只有重排风险容器才发送安全 `innerHTML`，例如 `Hello <strong>world</strong>`。
- 模型必须只翻译可见文本，并完整保留 HTML 标签结构，例如返回 `你好，<strong>世界</strong>`。
- 纯文本路径写回时必须保留原有标签和属性，只更新承载可见文本的原始 Text 节点。
- 写回前必须解析、净化并校验返回 HTML，确认标签集合、标签嵌套和属性未被改变。
- 校验通过后，用安全重建后的 DOM 节点替换容器内容，不能直接信任模型返回字符串。
- 校验失败时，降级为单 Text 节点翻译，不写入模型返回的 HTML。
- 分组内如果包含 `pre`、`code`、`kbd`、`samp`，代码节点跳过，周围说明文本单独分组。
- 如果分组结构复杂或包含交互控件，退回到单 Text 节点翻译，宁可保守也不破坏页面。
- 写回时仍按 segment id 定位原节点或节点组。

节点组状态和单 Text 节点状态都进入同一个 registry，避免同一文本被重复翻译。

### 安全 HTML 校验

模型返回的 HTML 是不可信输入。`safe-html` 片段写回前必须经过 detached DOM 解析、结构校验和安全重建。

解析策略：

- 使用 `DOMParser` 或 `<template>` 在脱离页面的 DOM 中解析原 HTML 和译文 HTML。
- 不在解析前把模型返回内容写入真实页面 DOM。
- 解析失败或存在浏览器自动修复导致结构变化时，拒绝写回。

结构校验：

- 忽略文本节点内容，只比较元素节点结构。
- 元素 `tagName` 顺序必须一致。
- 元素嵌套位置必须一致。
- 原 HTML 中有开始/结束配对的标签，译文 HTML 中也必须保持同一对标签在同一 segment 内。
- 属性名和值必须与原 HTML 一致。
- 不接受模型新增、删除、重排或修改属性。

安全规则：

- 只允许安全容器策略中允许的标签。
- 禁止任何 `on*` 事件属性。
- 禁止 `style` 属性。
- 禁止 `srcdoc` 属性。
- 禁止 `javascript:` URL。
- 禁止新增 `href`、`src` 等 URL 属性。
- 校验通过后，根据译文 DOM 安全重建节点，再替换容器内容。

降级策略：

- HTML 结构不同，拒绝写回，降级单 Text 节点翻译。
- 属性不同，拒绝写回，降级单 Text 节点翻译。
- 出现危险标签或危险属性，拒绝写回，保留原文并记录失败原因。

跳过标签：

```ts
const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "INPUT",
  "SELECT",
  "OPTION",
  "PRE",
  "CODE",
  "KBD",
  "SAMP"
]);
```

### 文本过滤

跳过：

- 纯数字。
- 纯标点/符号。
- URL。
- 邮箱。
- hash 或长 ID。
- 小于 2 个可见字符的文本。
- 类似 CSS class、变量名、文件路径的机器标识符。

保留：

- 普通段落。
- 标题。
- 按钮文案。
- 表格文本。
- 导航文本。
- 表单 label。

### 可见性判断

页面翻译启动后立即扫描当前整页 DOM，不等待页面完全加载。

- 启动时直接整页入队当前已存在的可翻译内容。
- 后续新增 DOM 继续通过 `MutationObserver` 增量翻译。
- 隐藏元素跳过：`display: none`、`visibility: hidden`、`opacity: 0`、尺寸为 0。

## 增量翻译设计

页面翻译启动后，content script 创建：

- `MutationObserver`：观察新增 DOM。

流程：

1. MutationObserver 发现新增节点。
2. 立即从新增节点中提取候选文本节点并入队。
3. 队列按批次发送给 background。
4. 返回后按 run id 和 segment id 写回。

### 避免 observer 自触发

插件写回译文也会触发 MutationObserver。实现必须显式抑制这类自触发：

- 写回前将对应节点或节点组状态标记为 `translated`。
- 写回期间设置本 runner 的 `suppressMutations = true`。
- MutationObserver 回调中如果发现节点已在 registry 且状态为 `translated`，直接跳过。
- 写回完成后在 microtask 或短延迟后恢复 `suppressMutations = false`。
- 单项加载图标的插入、重挂载和移除也走同一抑制窗口，避免指示器节点反向触发重复扫描。
- 如果页面脚本随后又修改该节点文本，文本与 registry 的译文不一致时，才按新文本重新入队。

停止翻译时：

- disconnect 两个 observer。
- 清空待发送队列。
- 当前 run 标记为 stopped。
- 清理 registry 中仍处于未完成状态的单项加载图标。
- 后续旧返回全部丢弃。

## 节点状态设计

Content script 内部用 `WeakMap<Text, NodeState>` 保存节点状态，避免污染页面 DOM。

```ts
interface NodeState {
  segmentId: string;
  originalText: string;
  translatedText?: string;
  status: "pending" | "queued" | "translating" | "translated" | "failed";
  runId: string;
  errorMessage?: string;
}
```

节点组使用类似状态：

```ts
interface SegmentState {
  segmentId: string;
  container?: Element;
  textNodes: Text[];
  originalTexts: string[];
  originalHtml?: string;
  translatedText?: string;
  writeMode: "text-node" | "safe-html";
  status: "pending" | "queued" | "translating" | "translated" | "failed";
  runId: string;
  errorMessage?: string;
}
```

页面翻译可视化补充：

- `pending`、`queued`、`translating` 状态时，content 侧为该 segment 挂一个小型旋转指示器。
- `translated`、`failed` 状态时移除指示器。
- 指示器不写入 registry 的 `expectedTexts`，也不参与译文正确性校验。
- `text` segment 的指示器挂在最终可写文本节点右侧，保持原文本内容不变。
- `safe-html` segment 的指示器只能挂在容器元素右侧外部；不能插入容器内部，否则会破坏 `container.innerHTML === originalHtml` 的结构比对前提。

写回规则：

- 只写回当前 run id 的结果。
- 节点仍在文档内才写回。
- 节点原文未被页面脚本改动时优先写回。
- 如果节点原文已变化，放弃写回并重新入队新文本。
- `writeMode = "safe-html"` 时，只有容器仍满足安全容器条件才写回。
- 安全 HTML 写回前必须校验译文 HTML 与原 HTML 的标签结构一致。
- 校验通过后使用安全重建 DOM 替换容器内容，不直接把模型返回字符串赋给 `innerHTML`。
- 校验失败时保留原文，并把该容器降级为单 Text 节点翻译队列。

## 缓存设计

缓存 key：

```text
hash(providerConfigHash + "\n" + model + "\n" + targetLanguage + "\n" + segmentKind + "\n" + sourceSegment)
```

缓存层级：

- tab 内内存缓存：本次页面翻译去重。
- 可选 `chrome.storage.local` 持久缓存：V1 可以先不做持久缓存，避免容量和隐私复杂度。

V1 建议只做 tab 内缓存。原因很简单：网页文本可能敏感，持久缓存需要额外的清理和隐私说明。

说明：

- `segmentKind` 为 `text` 或 `safe-html`。
- `sourceSegment` 是实际发送给模型的规范化片段。
- 纯文本和 HTML 片段即使可见文本相同，也不能共享缓存。

## OpenAI 兼容请求

默认 endpoint：

```text
{selectedModelConfig.baseUrl}/chat/completions
```

`/chat/completions` 固定写死。保存配置时只去掉 `baseUrl` 末尾 `/`，不自动追加或删除 `/v1`。

请求：

```json
{
  "temperature": 0,
  "model": "用户配置模型",
  "stream": true,
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "{...}" }
  ]
}
```

处理：

- 使用 `AbortController` 实现 timeout。
- HTTP 401/403：配置或权限错误，不重试。
- HTTP 429/5xx/网络超时：可重试。
- 最多重试 2 次。
- 如果尚未收到任何可用增量，可以按重试规则重发。
- 如果已经完成了部分 `id`，不再重试整个批次覆盖已完成结果，只把缺失 `id` 标记失败。
- 错误信息脱敏，不展示完整 API Key。

## MV3 Service Worker 生命周期

Manifest V3 的 background service worker 可能被浏览器挂起，不能假设它长期驻留。

状态归属：

- content script 是页面运行态事实来源：当前 frame 是否启动翻译、当前 run id、observer 是否运行、队列状态、节点状态都以 content runner 为准。
- background 的 `tab-state` 是路由和聚合缓存，允许因 service worker 重启而丢失。
- service worker 重启后，popup 查询状态时，background 应主动向当前 tab/frame 的 content script 发送状态查询，再重建聚合状态。
- 如果 background 在流式回传前丢失了某个 frame 的活动 run 记录，则在收到该 frame 发起的下一次 `TRANSLATE_BATCH` 时，立即按 `sender.tab.id + frameId + runId` 恢复 `tab-state` 路由，再继续后续 chunk/done 推送。
- 已经发出的模型请求不要求跨 service worker 生命周期恢复。如果 service worker 被回收导致请求失败，content runner 按超时或连接错误处理，并可重新入队。

状态查询消息：

状态查询分两层：

- Popup 向 background 发送 `GET_TAB_STATUS`。
- Background 向当前 tab 的 content frames 发送 `QUERY_RUNNER_STATUS`。
- Content frames 返回 `RUNNER_STATUS`。
- Background 汇总 frame 状态后向 popup 返回 `TAB_STATUS`。

```ts
interface QueryRunnerStatusMessage {
  type: "QUERY_RUNNER_STATUS";
}

interface RunnerStatusMessage {
  type: "RUNNER_STATUS";
  frameId: number;
  runId?: string;
  status: "idle" | "running" | "stopped";
  pendingCount: number;
  translatingCount: number;
}
```

## 右键菜单设计

安装或启动时注册：

- `translate-page`: 翻译当前页面。
- `translate-selection`: 翻译选中文本，仅在 selection context 出现。
- `stop-page-translation`: 停止翻译当前页面。

菜单点击处理：

- 没有配置完整时，打开 options 页面或提示用户先配置。
- 页面不支持 content script 时，提示当前页面不可翻译。
- `chrome://`、扩展商店等受限页面需要明确错误提示。

## Popup 设计

UI 元素：

- 配置状态：已配置 / 未配置。
- 当前页面状态：未启动 / 翻译中 / 已停止 / 当前页面不可用。
- 按钮：
  - 翻译当前页面。
  - 停止翻译。
  - 打开配置。

Popup 启动时：

1. 查询当前 active tab。
2. 向 background 请求 tab 状态。
3. 渲染按钮状态。

## Options 设计

保存时校验：

- 至少存在一个模型接口。
- 每个模型接口的名称 / Base URL / API Key / Model 都不为空。
- 必须选中一个当前使用的模型接口。
- 目标语言不为空。
- 批次限制和超时时间必须是正数。

可以提供“测试连接”按钮：

- 用一个短文本请求模型。
- 成功则提示配置可用。
- 失败则显示脱敏错误。

测试连接不是 V1 必须项，但强烈建议做。否则用户很难判断是网页问题还是 API 配置问题。

## 安全与隐私

- API Key 只存储在 `chrome.storage.local`。
- API Key 只在 background service worker 中读取和使用。
- content script 不接收、不缓存、不打印 API Key。
- 页面文本只发送给用户配置的 Base URL。
- 插件不把用户网页内容发送到插件作者服务器。
- 插件不把网页翻译原文、译文或模型原始响应持久化保存到 `chrome.storage.local`。
- 日志和错误提示必须脱敏。
- 真实浏览器诊断可通过内部 `GET_BUILD_INFO` 消息核对 background/content 是否来自当前构建。
- 悬浮框 DOM 不包含 API 配置。
- 仓库文档提供正式隐私政策：`docs/privacy-policy.md`。

需要在 options 页面展示简短说明：

> 只有在你手动触发翻译时，选中文本或网页文本才会发送到你配置的模型服务商。插件不会把网页文本发送到作者服务器，也不会持久化保存网页翻译内容。

## 错误处理

错误分类：

- `SETTINGS_INCOMPLETE`：配置缺失。
- `UNSUPPORTED_PAGE`：当前页面不允许注入或通信。
- `API_AUTH_FAILED`：API Key 或权限错误。
- `API_RATE_LIMITED`：服务商限流。
- `API_TIMEOUT`：请求超时。
- `API_BAD_RESPONSE`：模型返回非预期格式。
- `TRANSLATION_STOPPED`：run 已停止，忽略返回。
- `NODE_CHANGED`：节点内容已变化，放弃写回。

用户可见错误要短：

- “请先完成 API 配置。”
- “当前页面不支持翻译。”
- “API Key 无效或无权限。”
- “模型返回格式异常，已保留原文。”
- “请求超时，请稍后重试或调小批次大小。”

## 性能控制

默认限制：

- 每批默认最多 12000 个原文字符，用作模型窗口保护。
- 内容脚本最多并发 3 个批次请求；每个请求仍必须满足单批字符上限。
- MutationObserver 变更使用 debounce，例如 200ms。
- 启动后立即翻译当前整页已存在内容，不等待页面加载完成。

大页面策略：

- 每个请求仍受 `maxCharsPerBatch` 限制，避免超过模型窗口。
- 已翻译和失败节点不重复入队。

## 测试设计

### 单元测试

- `text-filter.test.ts`
  - 过滤 URL、邮箱、纯数字、纯符号、代码样式文本。
  - 保留普通标题、按钮、段落、表格文本。
- `batch-protocol.test.ts`
  - 正常 JSON 映射。
  - 顶层对象 `{ items: [...] }` 解析。
  - 返回乱序仍按 ID 写回。
  - 缺失 ID 标记失败。
  - 未知 ID 忽略。
  - 非法 JSON 触发降级。
  - Markdown 代码块包裹 JSON 时可以提取解析。
- `tab-state.test.ts`
  - start 生成 run id。
  - stop 标记停止。
  - restart 生成新 run id。
  - tab/frame 状态按 `tabId + frameId + runId` 隔离。
- `run-id.test.ts`
  - 旧请求返回不会写入新 run。
- `openai-client.test.ts`
  - endpoint 拼接。
  - timeout。
  - 401 不重试。
  - 429/5xx 可重试。
  - 错误脱敏。
- `segment-write.test.ts`
  - 单 Text 节点写回。
  - 安全 HTML 片段可整体写回。
  - 同一对 HTML 开始/结束标签不能跨 segment。
  - 模型返回标签结构变化时拒绝写回。
  - 模型返回新增属性时拒绝写回。
  - 模型返回危险属性时拒绝写回。
  - 校验通过后使用安全重建 DOM 写回。
  - 含交互元素或不在安全标签白名单内的复杂结构退回单节点策略。
- `cache-key.test.ts`
  - `text` 和 `safe-html` 使用不同缓存 key。
  - HTML 片段使用规范化后的 `sourceSegment` 参与缓存 key。
- `service-worker-lifecycle.test.ts`
  - background 状态丢失后可通过 content runner 状态查询恢复 popup 显示。

### 手工测试

- 页面打开后不自动翻译。
- 右键翻译普通文章页。
- popup 翻译普通文章页。
- 停止后滚动不再翻译。
- 停止后旧请求返回不写回。
- 无限滚动页面新内容只翻译一次。
- GitHub README 中代码块不被翻译，说明文字被翻译。
- 表格页面翻译正常。
- 选区翻译显示悬浮框，点击外部关闭。
- iframe 内选区翻译显示在对应 iframe 内，不显示到主页面。
- iframe 内页面翻译不污染主 frame 的 run 状态。
- 模拟 service worker 重启后，popup 能重新显示当前页面翻译状态。
- `Hello <strong>world</strong>` 可作为安全 HTML 片段交给模型翻译并保留标签。
- 模型返回不安全 HTML 时拒绝写回。
- API Key 错误显示可理解错误。
- 受限页面显示不可翻译。
- 真实浏览器验证优先连接 `127.0.0.1:9222` 的现有浏览器；仅当该端口没有可用实例时，才启动新的浏览器实例。
- 真实浏览器验证优先使用 GPT API；mock 仅用于隔离诊断、最小复现或无法安全调用真实接口时的补充验证。
- 每次代码修改后，至少执行一轮与本次改动直接相关的回归测试。

## 实现顺序

1. 项目脚手架：Manifest V3、TypeScript、构建、基础目录。
2. 设置页：保存和读取 OpenAI 兼容配置。
3. Background：右键菜单、tab 状态、消息协议。
4. OpenAI 请求层：chat completions、timeout、错误归一化。
5. 选区翻译：右键选区、请求模型、悬浮框展示和关闭。
6. DOM 扫描和文本过滤：当前视口文本提取。
7. 页面翻译：批处理协议、按 ID 写回文本节点。
8. 增量翻译：MutationObserver、队列去重。
9. 停止翻译：popup/右键停止、observer 清理、run id 防旧写回。
10. Popup：状态展示、启动、停止、配置入口。
11. 单元测试和手工测试。

## 开放问题

- 是否需要在 V1 提供“测试连接”按钮。技术上建议做，能显著降低配置问题排查成本。
- 是否允许用户调整并发数。V1 建议不暴露，只保留内部默认值。
- 是否做持久翻译缓存。V1 建议不做，避免隐私和容量问题。
- 是否需要站点级开关。当前方案是手动触发，V1 可以先不做。
