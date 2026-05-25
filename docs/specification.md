# 规格文档：基于大模型的 Chrome 网页翻译插件 V1

状态：草稿
日期：2026-05-21
依据：`docs/technical-design.md`

## 1. 范围

### 1.1 V1 必须实现

- Chrome Manifest V3 插件。
- 用户手动触发网页翻译。
- 用户手动触发选区翻译。
- 页面翻译原地替换可访问 DOM 文本。
- 页面翻译启动后，对滚动进入视口的新内容做增量翻译。
- 页面翻译启动后，对动态插入的新内容做增量翻译。
- 通过 OpenAI 兼容接口调用用户自己的模型服务商。
- API Key 不下发给 content script。
- 支持安全 HTML 片段翻译，例如 `Hello <strong>world</strong>`。
- 支持停止当前页面翻译。
- 支持 popup 查看状态、启动翻译、停止翻译、进入配置。

### 1.2 V1 禁止实现或不承诺

- 页面打开后自动翻译。
- 原文 / 译文 / 双语模式切换。
- PDF 翻译。
- OCR / 图片文字翻译。
- 视频字幕翻译。
- Canvas 渲染文字翻译。
- 内置厂商账号。
- 插件作者代理服务。
- 持久化网页翻译缓存。

## 2. 构建规格

### SPEC-BUILD-001：源码与产物

源码必须位于 `src/`，Chrome 加载的文件必须来自 `dist/`。

构建后必须生成：

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

验收：

- `dist/manifest.json` 中不得引用 `src/*.ts`。
- Chrome 扩展加载目录必须是 `dist/`。

### SPEC-BUILD-002：依赖边界

除构建和测试依赖外，V1 不得引入运行时前端框架或复杂业务依赖。

允许：

- TypeScript。
- Vite 或等价轻量构建工具。
- 测试框架。

禁止：

- React / Vue / Angular 等运行时 UI 框架。
- 大型 DOM 操作库。
- 大型状态管理库。

## 3. Manifest 与权限规格

### SPEC-MANIFEST-001：Manifest V3

插件必须使用 Manifest V3。

必须声明：

- `contextMenus`
- `storage`
- `activeTab`
- `scripting`
- `tabs`
- `host_permissions: ["<all_urls>"]`
- `content_scripts[].all_frames = true`

### SPEC-MANIFEST-002：手动触发约束

content script 可以静态注入所有页面，但不得在页面打开后自动扫描、自动翻译或自动发送页面文本。

验收：

- 打开任意普通网页后，不发生模型 API 请求。
- 打开任意普通网页后，页面 DOM 文本不被修改。

### SPEC-MANIFEST-003：受限页面

对无法注入或通信的页面，必须显示“当前页面不支持翻译”或等价短错误。

典型页面：

- `chrome://*`
- Chrome Web Store。
- 浏览器限制注入的受保护页面。

## 4. 配置规格

### SPEC-SETTINGS-001：配置字段

配置必须包含：

```ts
interface ModelApiConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  jsonOutputMode: boolean;
}

interface Settings {
  modelConfigs: ModelApiConfig[];
  selectedModelConfigId: string;
  targetLanguage: string;
  requestTimeoutMs: number;
  maxCharsPerBatch: number;
}
```

默认值：

```ts
const DEFAULT_SETTINGS = {
  modelConfigs: [
    {
      id: "default",
      name: "默认接口",
      baseUrl: "",
      apiKey: "",
      model: "",
      jsonOutputMode: false
    }
  ],
  selectedModelConfigId: "default",
  targetLanguage: "中文",
  requestTimeoutMs: 30000,
  maxCharsPerBatch: 12000
};
```

### SPEC-SETTINGS-002：Base URL 规则

每个 `modelConfigs[n].baseUrl` 都必须表示 OpenAI 兼容 API base，并包含版本路径。

示例：

- `https://api.openai.com/v1`
- `https://api.example.com/v1`

保存时：

- 必须去掉末尾 `/`。
- 不得自动追加 `/v1`。
- 不得自动删除 `/v1`。

最终请求地址：

```text
selectedModelConfig.baseUrl + "/chat/completions"
```

默认组合：

```text
https://api.openai.com/v1/chat/completions
```

### SPEC-SETTINGS-003：配置校验

保存配置时必须校验：

- `modelConfigs` 至少包含 1 项。
- 每个接口的 `name` 非空。
- 每个接口的 `baseUrl` 非空。
- 每个接口的 `apiKey` 非空。
- 每个接口的 `model` 非空。
- `selectedModelConfigId` 必须命中已有接口。
- `targetLanguage` 非空。
- `requestTimeoutMs > 0`。
- `maxCharsPerBatch > 0`。

### SPEC-SETTINGS-004：隐私提示

Options 页面必须展示：

> 翻译时，选中文本或网页文本会发送到你配置的模型服务商。插件不会把内容发送到作者服务器。

## 5. 消息协议规格

所有消息类型必须定义在 `src/shared/messages.ts`。

### SPEC-MSG-001：消息联合类型

必须包含：

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

### SPEC-MSG-002：启动页面翻译

Popup 或 context menu 发给 background：

```ts
interface StartPageTranslationMessage {
  type: "START_PAGE_TRANSLATION";
  tabId: number;
}
```

Background 发给 content script：

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

约束：

- `settingsView` 不得包含 API Key。
- `frameId` 必须存在。

### SPEC-MSG-003：停止页面翻译

```ts
interface StopPageTranslationMessage {
  type: "STOP_PAGE_TRANSLATION";
  tabId: number;
  runId?: string;
}
```

content script 收到后必须：

- 标记当前 run 停止。
- disconnect MutationObserver。
- 清空未发送队列。
- 忽略旧请求返回。

### SPEC-MSG-004：批量翻译请求

content script 发给 background：

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

约束：

- `sum(segments[].text.length) <= maxCharsPerBatch`。
- 每个 `id` 在当前 run 内必须唯一。
- `kind = "safe-html"` 的片段必须来自安全 HTML 容器。

### SPEC-MSG-005：批量翻译流式返回

Background 必须先快速返回：

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
```

随后通过 `chrome.tabs.sendMessage(tabId, message, { frameId })` 推送流式消息：

```ts
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

约束：

- 增量写回必须按 `id` 匹配。
- 不得依赖返回顺序。
- 未知 `id` 必须忽略。
- `done = false` 只允许纯文本片段渐进写回。
- `done = true` 表示该 `id` 已收到最终结果。
- `TRANSLATE_BATCH_STREAM_DONE` 到达后，当前 `batchId` 中缺失的 `id` 必须标记失败。

### SPEC-MSG-006：选区悬浮框

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

路由：

- 必须通过 `chrome.tabs.sendMessage(tabId, message, { frameId })` 定向发送。
- `frameId` 不得放在消息体中。

流程：

1. 右键选区触发后，background 立即向 `info.frameId` 发送 `loading`。
2. content script 读取并缓存 selection rect。
3. 模型流式返回时，background 向同一 frame 持续发送 `streaming`。
4. 模型调用完成后，background 向同一 frame 发送 `success`。
5. 模型调用失败后，background 向同一 frame 发送 `error`。

## 6. 状态规格

### SPEC-STATE-001：Run ID

每次启动页面翻译必须生成新的 `runId`。

写回必须同时匹配：

- `tabId`
- `frameId`
- `runId`
- `segmentId`

旧 run 返回结果不得写入新 run。

### SPEC-STATE-002：Frame 状态

页面翻译状态按 `tabId + frameId + runId` 路由。

主 frame 和子 frame 各自运行 runner。

### SPEC-STATE-003：状态查询

Popup 查询状态流程：

1. Popup 向 background 发送 `GET_TAB_STATUS`。
2. Background 向当前 tab 的 content frames 发送 `QUERY_RUNNER_STATUS`。
3. Content frames 返回 `RUNNER_STATUS`。
4. Background 汇总 frame 状态。
5. Background 向 popup 返回 `TAB_STATUS`。

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

### SPEC-STATE-004：Service Worker 生命周期

Background service worker 不得被当作长期状态事实来源。

约束：

- content script 是页面运行态事实来源。
- background 的 `tab-state` 只是路由和聚合缓存。
- service worker 重启后必须通过 `QUERY_RUNNER_STATUS` 重建 popup 所需状态。
- 如果 background 在批量翻译流式回传前丢失了某个 frame 的运行态缓存，则在接收到该 frame 的 `TRANSLATE_BATCH` 时必须按 `sender.tab.id + frameId + runId` 立即恢复该路由状态。
- service worker 被回收导致请求失败时，content runner 可重新入队。

## 7. DOM 扫描规格

### SPEC-DOM-001：文本节点候选条件

Text 节点必须同时满足：

- 父元素可见。
- `textContent.trim()` 非空。
- 不在跳过标签内。
- 不在 `contenteditable` 内。
- 不在输入控件内。
- 通过文本过滤规则。

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

### SPEC-DOM-002：文本过滤

必须跳过：

- 纯数字。
- 纯标点或符号。
- URL。
- 邮箱。
- hash 或长 ID。
- 少于 2 个可见字符的文本。
- 类 CSS class、变量名、文件路径的机器标识符。

必须保留：

- 普通段落。
- 标题。
- 按钮文案。
- 表格文本。
- 导航文本。
- 表单 label。

### SPEC-DOM-003：可见性判断

页面翻译启动后必须立即扫描当前整页 DOM，不等待页面完全加载。

后续动态新增内容继续通过 `MutationObserver` 增量翻译。

必须跳过：

- `display: none`
- `visibility: hidden`
- `opacity: 0`
- 尺寸为 0 的元素。

## 8. 安全 HTML 片段规格

### SPEC-HTML-001：允许的 safe-html

允许整体作为 `safe-html` 发送给模型的容器标签：

- `a`
- `button`
- `label`
- `td`
- `th`
- `li`
- `p`
- `h1`
- `h2`
- `h3`
- `h4`
- `h5`
- `h6`

这些标签只是 `safe-html` 候选容器，不代表一定发送 HTML。
默认策略仍然是优先发送纯文本，只有在跨多个有效文本节点、存在内联标签重排风险、且无法本地安全回填时，才允许降级为 `safe-html`。

安全容器内部只允许：

- 文本节点。
- `span`
- `strong`
- `em`
- `b`
- `i`

安全容器内部不得包含：

- 交互元素。
- 表单元素。
- 媒体元素。
- 脚本。
- 不在白名单内的标签。
- 复杂嵌套组件。

### SPEC-HTML-002：分段约束

允许翻译内容包含 HTML。

必须保证同一对 HTML 开始标签和结束标签在同一个 segment 内。

禁止把 `<strong>` 和 `</strong>` 拆到不同请求或不同片段。

### SPEC-HTML-003：模型约束

对于 `safe-html` 输入，提示词必须要求模型：

- 只翻译标签内可见文本。
- 完整保留所有 HTML 标签。
- 完整保留所有属性。
- 不新增标签。
- 不删除标签。
- 不重排标签。
- 不拆散开始标签和结束标签。

对于简单包装容器，必须只发送可见文本，不得把完整标签一并发给模型。

示例：

- `<span title="effective_aniii">effective_aniii</span>` -> 发送 `effective_aniii`
- `<strong><span>Hello world</span></strong>` -> 发送 `Hello world`
- `Hello <strong>world</strong>` -> 可降级为 `safe-html`

### SPEC-HTML-004：返回校验

模型返回的 HTML 是不可信输入。

写回前必须：

1. 在 detached DOM 中解析原 HTML。
2. 在 detached DOM 中解析译文 HTML。
3. 比较元素节点结构。
4. 校验安全规则。
5. 用安全重建 DOM 写回。

结构校验必须满足：

- 忽略文本节点内容。
- 元素 `tagName` 顺序一致。
- 元素嵌套位置一致。
- 属性名和值一致。
- 不接受新增属性。
- 不接受删除属性。
- 不接受修改属性。

安全规则：

- 只允许白名单标签。
- 禁止任何 `on*` 事件属性。
- 禁止 `style` 属性。
- 禁止 `srcdoc` 属性。
- 禁止 `javascript:` URL。
- 禁止新增 `href`、`src` 等 URL 属性。

### SPEC-HTML-005：HTML 降级

以下情况必须拒绝写回 safe-html：

- HTML 解析失败。
- 浏览器自动修复导致结构变化。
- 标签结构不同。
- 属性不同。
- 出现危险标签。
- 出现危险属性。

拒绝后：

- 不写入模型返回 HTML。
- 保留原文。
- 可将该容器降级为单 Text 节点翻译队列。

## 9. 翻译批处理规格

### SPEC-BATCH-001：请求格式

用户消息必须使用：

```json
{
  "targetLanguage": "中文",
  "segments": [
    { "id": "n1", "kind": "text", "text": "Hello world" },
    { "id": "n2", "kind": "safe-html", "text": "Hello <strong>world</strong>" }
  ]
}
```

### SPEC-BATCH-002：返回格式

模型必须返回：

```json
{
  "items": [
    { "id": "n1", "text": "你好，世界" },
    { "id": "n2", "text": "你好，<strong>世界</strong>" }
  ]
}
```

只接受：

```ts
interface TranslationResponse {
  items: Array<{
    id: string;
    text: string;
  }>;
}
```

流式模式下，assistant 必须按输入顺序输出：

```text
[[ITEM:n1]]你好，世界[[/ITEM]][[ITEM:n2]]你好，<strong>世界</strong>[[/ITEM]]
```

### SPEC-BATCH-003：结构化输出

默认不得发送 `response_format`。

仅当用户配置开启或服务商模板明确支持时，才允许发送：

```json
{
  "response_format": { "type": "json_object" }
}
```

无论是否发送 `response_format`，都必须校验返回 schema。

### SPEC-BATCH-003A：流式协议

默认优先发送 `stream: true`。

流式约束：

- 仍然调用 `selectedModelConfig.baseUrl + "/chat/completions"`。
- assistant 不得返回 JSON。
- assistant 必须严格使用 `[[ITEM:<id>]]...[[/ITEM]]` 包裹每个译文片段。
- `safe-html` 片段可以流式接收，但只能在 `[[/ITEM]]` 完整闭合后做安全校验并一次性写回。
- 如果服务商不支持流式并返回普通 JSON，必须自动回退到非流式解析路径。

### SPEC-BATCH-004：JSON 解析

必须支持：

- 直接 JSON 对象。
- Markdown 代码块包裹的第一段 JSON。

必须拒绝：

- 非 JSON。
- 顶层数组。
- 缺少 `items`。
- `items` 不是数组。
- item 缺少 `id`。
- item 缺少 `text`。
- item 含未知 ID 时该项忽略。

### SPEC-BATCH-005：降级规则

降级顺序：

1. 原批次。
2. 更小批次。
3. 单片段。
4. 标记失败并保留原文。

触发降级：

- JSON 解析失败。
- schema 校验失败。
- 请求超时。
- 可重试 API 错误。

不可重试错误不得继续拆批重试：

- 401。
- 403。
- 配置缺失。

## 10. OpenAI 兼容请求规格

### SPEC-API-001：请求地址

请求地址：

```text
selectedModelConfig.baseUrl + "/chat/completions"
```

默认：

```text
https://api.openai.com/v1/chat/completions
```

### SPEC-API-002：请求体

必须包含：

```json
{
  "model": "<selectedModelConfig.model>",
  "temperature": 0,
  "stream": true,
  "messages": [
    { "role": "system", "content": "<system prompt>" },
    { "role": "user", "content": "<json payload>" }
  ]
}
```

当 `selectedModelConfig.jsonOutputMode = true` 时，允许追加：

```json
{
  "response_format": { "type": "json_object" }
}
```

### SPEC-API-003：超时与重试

必须使用 `AbortController` 实现超时。

默认超时：`30000ms`。

重试规则：

- 401/403 不重试。
- 429 可重试。
- 5xx 可重试。
- 网络超时可重试。
- 最多重试 2 次。

流式重试约束：

- 如果尚未收到任何可用增量，可按上述规则重试。
- 如果已经完成了部分 `id`，不得重试整个批次覆盖已完成结果；缺失 `id` 标记失败即可。
- 流式请求超时按 SSE 空闲时间计算，收到任意 chunk 后必须刷新超时计时；非流式请求仍按整次请求计时。

### SPEC-API-004：错误脱敏

错误信息不得包含完整 API Key。

允许展示脱敏尾号，例如：

```text
sk-****abcd
```

调试诊断日志如果记录真实批次输入输出，必须保证并发追加不丢失条目；同一次页面翻译的多个并发批次都应可追溯。
调试诊断日志写入不得阻塞页面翻译的 chunk/done 回传或 runner 完成态收口。

真实浏览器诊断允许读取内部 `GET_BUILD_INFO` 消息返回的构建标记，用于确认页面 content script 和 background service worker 已加载当前构建。

## 11. 页面翻译运行规格

### SPEC-RUN-001：启动

用户点击“翻译当前页面”后：

1. background 校验配置。
2. background 生成 run id。
3. background 向目标 tab/frame 发送启动消息。
4. content runner 立即扫描当前整页已存在文本，不等待页面加载完成。
5. content runner 建立 observer。
6. content runner 为每个拆分出的待翻译 segment 在对应页面内容右侧显示一个小型旋转图标。
7. content runner 批量发送翻译请求。

### SPEC-RUN-002：增量翻译

页面翻译启动后：

- MutationObserver 发现新增 DOM。
- 从新增 DOM 提取候选文本。
- 立即加入翻译队列。
- 每个新入队 segment 必须立即显示单项加载图标，不等待网络请求真正发出。

### SPEC-RUN-003：停止

用户点击“停止翻译”后：

- runner 状态变为 `stopped`。
- 停止 MutationObserver。
- 清空未发送队列。
- 清理当前 run 尚未结束的单项加载图标。
- 已发出的请求返回后不得写回页面。

### SPEC-RUN-004：自触发抑制

插件写回译文时必须避免 MutationObserver 自触发。

要求：

- 写回前标记节点或 segment 为 `translated`。
- 写回期间设置 `suppressMutations = true`。
- MutationObserver 遇到已翻译节点直接跳过。
- 写回完成后恢复 `suppressMutations = false`。
- 单项加载图标的插入和移除也必须走同一抑制窗口，避免自触发重复扫描。

### SPEC-RUN-005：单项加载图标

页面翻译模式下，每个拆分出的 segment 在其对应页面内容右侧必须显示小型旋转图标。

显示和移除规则：

- `pending`、`queued`、`translating` 状态显示图标。
- `translated`、`failed` 状态移除图标。
- 用户停止当前页面翻译时，必须清理所有残留图标。

挂载规则：

- `text` segment 的图标必须挂在最终可写入文本节点右侧。
- `safe-html` segment 的图标必须挂在容器元素右侧外部，不得插入容器内部。
- 图标渲染失败时允许静默跳过，但不得影响翻译主流程或 safe-html 结构校验。

## 12. 选区翻译规格

### SPEC-SELECTION-001：触发

用户右键选区并点击“翻译选中文本”后：

1. background 从 context menu info 读取 `selectionText`。
2. background 立即向 `info.frameId` 发送 loading 悬浮框消息。
3. content script 读取并缓存 selection rect。
4. background 调用模型。
5. background 向同一 frame 发送 success 或 error。

### SPEC-SELECTION-002：悬浮框关闭

悬浮框必须在用户点击悬浮框外部时关闭。

悬浮框不得永久修改页面内容。

### SPEC-SELECTION-003：定位降级

定位顺序：

1. 当前 selection rect。
2. 最近缓存 selection rect。
3. 视口右上角。

## 13. Popup 规格

### SPEC-POPUP-001：显示状态

Popup 必须显示：

- 配置状态：已配置 / 未配置。
- 当前页面状态：未启动 / 翻译中 / 已停止 / 当前页面不可用。

### SPEC-POPUP-002：按钮

Popup 必须提供：

- 翻译当前页面。
- 停止翻译。
- 打开配置。

按钮状态：

- 配置未完成时，“翻译当前页面”不可执行，并提示先配置。
- 当前页面不可用时，“翻译当前页面”不可执行。
- 未启动时，“停止翻译”不可执行。
- 翻译中时，“停止翻译”可执行。

## 14. 右键菜单规格

### SPEC-MENU-001：菜单项

必须注册：

- `translate-page`：翻译当前页面。
- `translate-selection`：翻译选中文本。
- `stop-page-translation`：停止翻译当前页面。

`translate-selection` 仅在 selection context 出现。

### SPEC-MENU-002：错误处理

配置缺失时：

- 打开 options 页面，或展示“请先完成 API 配置”。

页面不支持时：

- 展示“当前页面不支持翻译”。

## 15. 缓存规格

### SPEC-CACHE-001：缓存范围

V1 只做 tab/frame/run 内存缓存。

不得持久化网页翻译缓存到 `chrome.storage.local`。

### SPEC-CACHE-002：缓存 key

缓存 key：

```text
hash(providerConfigHash + "\n" + model + "\n" + targetLanguage + "\n" + segmentKind + "\n" + sourceSegment)
```

要求：

- `segmentKind` 必须是 `text` 或 `safe-html`。
- `sourceSegment` 必须是实际发送给模型的规范化片段。
- 纯文本和 HTML 片段不得共享缓存。

## 16. 错误规格

### SPEC-ERROR-001：错误码

必须定义：

- `SETTINGS_INCOMPLETE`
- `UNSUPPORTED_PAGE`
- `API_AUTH_FAILED`
- `API_RATE_LIMITED`
- `API_TIMEOUT`
- `API_BAD_RESPONSE`
- `TRANSLATION_STOPPED`
- `NODE_CHANGED`
- `HTML_UNSAFE`
- `HTML_STRUCTURE_CHANGED`

### SPEC-ERROR-002：用户可见文案

用户可见错误必须短。

建议文案：

- “请先完成 API 配置。”
- “当前页面不支持翻译。”
- “API Key 无效或无权限。”
- “模型返回格式异常，已保留原文。”
- “请求超时，请稍后重试或调小批次大小。”
- “模型返回的 HTML 不安全，已保留原文。”

## 17. 性能规格

### SPEC-PERF-001：默认限制

默认限制：

- 每批默认最多 12000 个原文字符，用作模型窗口保护。
- 页面翻译最多并发 3 个批次请求；每个批次仍必须满足字符数限制。
- MutationObserver debounce 默认 200ms。

### SPEC-PERF-002：大页面策略

必须：

- 启动后立即处理当前整页已存在的可翻译文本，不等待页面加载完成。
- 当前页面全部可翻译文本处理完成后，本次页面翻译自动停止。
- 已翻译节点不重复入队。
- 失败节点不重复入队，除非用户重新启动页面翻译。

## 18. 测试规格

### SPEC-TEST-001：单元测试

必须覆盖：

- 文本过滤。
- 批量协议解析。
- 顶层 `{ items: [...] }` 解析。
- Markdown 代码块 JSON 提取。
- ID 乱序写回。
- 缺失 ID。
- 未知 ID。
- text / safe-html 缓存 key 区分。
- safe-html 结构校验。
- safe-html 危险属性拒绝。
- run id 防旧请求写回。
- tab/frame 状态隔离。
- service worker 状态恢复。
- endpoint 拼接。
- API 超时。
- API 错误脱敏。

### SPEC-TEST-002：手工测试

必须覆盖：

- 页面打开后不自动翻译。
- 右键翻译普通文章页。
- popup 翻译普通文章页。
- 停止后滚动不再翻译。
- 停止后旧请求返回不写回。
- 无限滚动页面新内容只翻译一次。
- GitHub README 中代码块不被翻译，说明文字被翻译。
- 表格页面翻译正常。
- 选区翻译显示悬浮框，点击外部关闭。
- iframe 内选区翻译显示在对应 iframe 内。
- iframe 内页面翻译不污染主 frame run 状态。
- service worker 重启后 popup 能重新显示当前页面翻译状态。
- `Hello <strong>world</strong>` 作为 safe-html 翻译并保留标签。
- 模型返回不安全 HTML 时拒绝写回。
- API Key 错误显示可理解错误。
- 受限页面显示不可翻译。
- 真实浏览器验证优先连接 `127.0.0.1:9222` 的现有浏览器；仅当该端口没有可用实例时，才启动新的浏览器实例。
- 真实浏览器验证优先使用 GPT API；mock 仅用于隔离诊断、最小复现或无法安全调用真实接口时的补充验证。
- 每次代码修改后，必须执行至少一轮与变更范围对应的回归测试。

## 19. 完成标准

V1 视为完成必须满足：

- `dist/` 可作为 Chrome unpacked extension 加载。
- Options 能保存有效配置。
- 页面打开后不会自动翻译。
- 右键和 popup 都能启动页面翻译。
- 页面翻译能原地替换普通 DOM 文本。
- 滚动后新内容能增量翻译。
- 停止后不继续翻译。
- 选区翻译悬浮框可用并可关闭。
- API Key 不进入 content script。
- safe-html 写回通过安全校验。
- 不安全 HTML 被拒绝。
- 单元测试通过。
- 手工测试清单通过。
- 修改后的相关功能完成回归测试。
