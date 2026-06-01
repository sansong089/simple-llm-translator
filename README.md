# Simple LLM Translator

一个基于 Chrome Manifest V3 的网页翻译扩展，使用你自己的 OpenAI 兼容 API 将任意网页翻译为目标语言。翻译结果直接替换页面 DOM 文本，不是浮层叠加，不是 iframe 注入。

## 为什么选择这个扩展

- **你的数据你做主** -- 没有内置服务商，没有作者代理服务器。所有文本只发送到你配置的 API 端点。
- **原地替换** -- 翻译直接写入页面 DOM，像网页本身就被翻译了一样。
- **流式显示** -- 支持 SSE 流式传输，翻译结果逐字出现在页面上。
- **智能 DOM 扫描** -- 自动识别可翻译文本，跳过代码块、URL、邮箱、变量名等不应翻译的内容。
- **安全 HTML 处理** -- 对于包含内联格式的文本，能保留 HTML 标签结构完成翻译。
- **增量翻译** -- 翻译启动后，滚动加载的新内容和动态插入的 DOM 也会自动翻译。
- **隐私优先** -- API Key 只在 background service worker 中使用，不下发到 content script，不出现在任何日志中。

## 功能

### 页面翻译

右键菜单或 popup 一键启动。扩展立即扫描整页 DOM，提取可翻译文本，按批次发送给模型，翻译结果原地替换。

翻译过程中每个待处理段落旁会显示旋转指示器，完成后自动消失。

### 选区翻译

选中任意文本，右键翻译选中文本，翻译结果以流式悬浮框展示在选区附近。点击页面其他位置关闭。

### 增量翻译

页面翻译启动后，MutationObserver 持续监听 DOM 变化：

- 滚动加载的新内容自动入队翻译。
- 动态插入的 DOM 自动提取并翻译。
- 已翻译的节点不会重复处理。

### 多模型配置

Options 页面支持配置多个 OpenAI 兼容 API 接口，随时切换。配置项包括接口名称、Base URL、API Key、Model 名称、是否启用 JSON 输出模式。

### 安全 HTML 翻译

对于包含内联格式的文本（如 Hello <strong>world</strong>），扩展不会简单地提取纯文本丢失格式，而是：

1. 分析容器标签结构，确认只包含安全的内联标签。
2. 将完整 HTML 发送给模型，要求保留标签结构。
3. 解析模型返回的 HTML，在脱离页面的 DOM 中校验标签结构一致性。
4. 校验通过后安全重建 DOM 写入页面。
5. 校验失败则保留原文，不写入任何不安全内容。

### Service Worker 生命周期适配

Manifest V3 的 background service worker 可能随时被浏览器挂起。扩展对此做了专门适配：content script 是页面运行态的事实来源，background 的 tab-state 只是路由缓存，丢失后可从 content script 重建。流式传输过程中 service worker 被回收不会导致页面翻译中断。

## 安装

### 从源码构建

```bash
git clone <repo-url>
cd chrome-translator
npm install
npm run build
```

构建产物在 `dist/` 目录。

### 加载到 Chrome

1. 打开 `chrome://extensions/`。
2. 开启开发者模式。
3. 点击加载已解压的扩展程序。
4. 选择项目的 `dist/` 目录。

## 配置

1. 点击扩展图标，选择打开配置。
2. 填写 API 信息：
   - **Base URL**：你的 OpenAI 兼容 API 地址，如 `https://api.openai.com/v1`。
   - **API Key**：你的 API Key。
   - **Model**：模型名称，如 `gpt-4o-mini`。
3. 选择目标翻译语言（默认：中文）。
4. 点击测试连接验证配置。
5. 保存。

支持的 API 端点：任何兼容 OpenAI `/chat/completions` 接口的服务。

## 使用

### 翻译整个页面

点击扩展图标选择翻译当前页面，或右键页面选择翻译当前页面。

### 翻译选中文本

选中文本，右键选择翻译选中文本。

### 停止翻译

点击扩展图标选择停止翻译，或右键页面选择停止翻译当前页面。

## 项目结构

```
src/
  background/            Service Worker
    service-worker.ts       消息路由、右键菜单、状态管理
    openai-client.ts        OpenAI API 请求、流式解析、重试
    translation-service.ts  翻译服务封装
    settings-store.ts       配置读写与校验
    tab-state.ts            Tab/Frame 状态聚合
    context-menu.ts         右键菜单注册
    diagnostic-log.ts       诊断日志（默认关闭）
  content/               Content Script
    content-script.ts       入口、消息监听
    translation-runner.ts   翻译运行器：队列、批处理、缓存、完成检测
    dom-scanner.ts          DOM 文本节点扫描与候选提取
    node-registry.ts        节点状态管理、译文写回
    safe-html.ts            安全 HTML 校验与重建
    floating-panel.ts       选区翻译悬浮框
    segment-indicator.ts    翻译进度指示器
    text-filter.ts          文本过滤规则
  shared/                共享模块
    types.ts                类型定义
    messages.ts             消息协议
    batch-protocol.ts       批处理协议、流式解析器
    constants.ts            常量与默认值
    errors.ts               错误类型
    hash.ts                 稳定哈希
  popup/                 Popup UI
  options/               Options 设置页
  privacy/               隐私政策
docs/
  specification.md         完整规格文档
  technical-design.md      技术设计文档
tests/
  unit/                    单元测试
```

## 技术栈

- TypeScript
- Vite（构建）
- Vitest（测试）
- Chrome Manifest V3
- 零运行时框架依赖

## 开发

```bash
# 构建
npm run build

# 单元测试
npm test

# 类型检查
npm run typecheck

# 冒烟测试（需要 Chrome 实例监听 9222 端口）
npm run smoke
npm run smoke:target
```

## 隐私

- API Key 只存储在 `chrome.storage.local`，只在 background service worker 中读取。
- 网页文本只发送到你配置的 API 端点，不会发送到扩展作者的服务器。
- 扩展不持久化保存任何网页翻译原文、译文或模型原始响应。
- 扩展不在未触发翻译的情况下向任何服务器发送请求。

## 许可证

MIT