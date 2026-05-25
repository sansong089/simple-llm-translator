import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import http from "node:http";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.slice(1));
const dist = resolve(root, "dist");
const extensionPath = dist.replaceAll("\\", "/");
const profile = resolve(root, ".tmp/target-page-profile");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const targetUrl =
  process.env.TARGET_URL ||
  "https://developer.signalwire.com/freeswitch/FreeSWITCH-Explained/Modules/mod_callcenter_1049389/";
const apiPort = 19091 + Math.floor(Math.random() * 1000);
const debugPort = 21000 + Math.floor(Math.random() * 20000);
let apiHits = 0;

if (!existsSync(dist)) throw new Error(`Missing dist: ${dist}`);
console.log("LOAD_EXTENSION", extensionPath);
console.log("TARGET_URL", targetUrl);
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });

const server = http.createServer(async (req, res) => {
  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    apiHits += 1;
    const body = await readBody(req);
    const parsed = JSON.parse(body);
    const user = parsed.messages.find((message) => message.role === "user")?.content;
    const payload = JSON.parse(user);
    const items = payload.segments.map((segment) => ({
      id: segment.id,
      text: translate(segment.text)
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) } }] }));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

await listen(server, apiPort);

const chrome = spawn(chromePath, [
  `--user-data-dir=${profile}`,
  `--disable-extensions-except=${extensionPath}`,
  `--load-extension=${extensionPath}`,
  `--remote-debugging-port=${debugPort}`,
  "--enable-unsafe-extension-debugging",
  "--enable-logging",
  "--v=1",
  "--no-first-run",
  "--no-default-browser-check",
  targetUrl
], { stdio: "ignore" });

try {
  const version = await waitForDebug();
  const browser = await connectCdp(version.webSocketDebuggerUrl);
  const targets = await waitForTargets(browser);
  const workerTarget = targets.find((target) => target.type === "service_worker" && isExtensionServiceWorker(target.url));
  const pageTarget = targets.find((target) => target.type === "page" && target.url.startsWith(targetUrl));
  if (!workerTarget?.webSocketDebuggerUrl) throw new Error(`Extension service worker target not found: ${describeTargets(targets)}`);
  if (!pageTarget?.webSocketDebuggerUrl) throw new Error(`Target page not found: ${describeTargets(targets)}`);

  const worker = await connectCdp(workerTarget.webSocketDebuggerUrl);
  const page = await connectCdp(pageTarget.webSocketDebuggerUrl);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await worker.send("Runtime.enable");
  await page.send("Page.reload", { ignoreCache: true });
  await runtimeEvaluate(page, { awaitPromise: true, expression: waitForPageReadyExpression() });

  await worker.send("Runtime.evaluate", {
    awaitPromise: true,
    expression: `chrome.storage.local.set({settings:${JSON.stringify({
      modelConfigs: [
        {
          id: "primary",
          name: "Mock",
          baseUrl: `http://127.0.0.1:${apiPort}/v1`,
          apiKey: "sk-test",
          model: "mock-model",
          jsonOutputMode: false
        }
      ],
      selectedModelConfigId: "primary",
      targetLanguage: "中文",
      requestTimeoutMs: 30000,
      maxCharsPerBatch: 12000
    })}})`
  });

  const before = await snapshotPage(page);
  const startResult = await worker.send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: startContentTranslationExpression(targetUrl, "target-page-smoke", { targetLanguage: "中文", maxCharsPerBatch: 12000 })
  });
  if (!startResult.result?.value?.ok) throw new Error(`Content start failed: ${JSON.stringify(startResult)}`);

  await waitForCondition(page, pageTranslatedExpression(), 12_000);
  const after = await snapshotPage(page);
  if (apiHits < 1) throw new Error("No API calls were made");
  if (!containsText(after.sidebar, "模块")) throw new Error(`Left sidebar was not translated: ${JSON.stringify(after.sidebar)}`);
  if (containsText(after.sidebar, "XML Modules Configuration")) throw new Error(`Left sidebar still contains original menu text: ${JSON.stringify(after.sidebar)}`);
  if (!containsText(after.toc, "关于")) throw new Error(`Right TOC was not translated: ${JSON.stringify(after.toc)}`);
  if (!containsText(after.article, "关于")) throw new Error(`Article heading was not translated: ${JSON.stringify(after.article)}`);

  console.log("TARGET_SMOKE_OK", JSON.stringify({ apiHits, before, after }));
  await worker.close();
  await page.close();
  await browser.close();
} finally {
  server.close();
  await wait(1000);
  chrome.kill();
}

function translate(text) {
  if (text.includes("<")) return translateHtmlText(text);
  return translatePlainText(text);
}

function containsText(values, text) {
  return values.some((value) => value.includes(text));
}

function translateHtmlText(html) {
  return html.replace(/(^|>)([^<>]+)(?=<|$)/g, (_match, prefix, text) => `${prefix}${translatePlainText(text)}`);
}

function translatePlainText(text) {
  const leading = text.match(/^\s*/)?.[0] ?? "";
  const trailing = text.match(/\s*$/)?.[0] ?? "";
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (/^mod[_-]/i.test(trimmed) || /^cc_/.test(trimmed)) return text;
  const dictionary = new Map([
    ["FreeSWITCH Explained", "FreeSWITCH 说明"],
    ["Modules", "模块"],
    ["XML Modules Configuration", "XML 模块配置"],
    ["About", "关于"],
    ["Configuration", "配置"],
    ["Settings", "设置"],
    ["Agent options", "座席选项"],
    ["Queue options", "队列选项"],
    ["Agents", "座席"],
    ["Variables", "变量"],
    ["Events", "事件"],
    ["See Also", "另请参阅"],
    ["Previous", "上一页"],
    ["Next", "下一页"]
  ]);
  return `${leading}${dictionary.get(trimmed) ?? `译文:${trimmed}`}${trailing}`;
}

async function snapshotPage(page) {
  const result = await runtimeEvaluate(page, {
    returnByValue: true,
    expression: `({
      loaded: Boolean(window.__LLM_TRANSLATOR_LOADED),
      sidebar: Array.from(document.querySelectorAll(".theme-doc-sidebar-container a, .theme-doc-sidebar-container span")).slice(0, 20).map((el) => el.textContent?.trim()).filter(Boolean),
      toc: Array.from(document.querySelectorAll(".table-of-contents a")).slice(0, 12).map((el) => el.textContent?.trim()).filter(Boolean),
      article: Array.from(document.querySelectorAll("article h1, article h2, article p")).slice(0, 10).map((el) => el.textContent?.trim()).filter(Boolean)
    })`
  });
  return result.result.value;
}

function waitForPageReadyExpression() {
  return `new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const ready = document.readyState === "complete" &&
        window.__LLM_TRANSLATOR_LOADED &&
        document.querySelector(".theme-doc-sidebar-container") &&
        document.querySelector("article") &&
        document.querySelector(".table-of-contents");
      if (ready) { resolve(true); return; }
      if (Date.now() - started > 30000) { reject(new Error("target page did not become ready")); return; }
      setTimeout(tick, 250);
    };
    tick();
  })`;
}

function pageTranslatedExpression() {
  return `(() => {
    const sidebar = Array.from(document.querySelectorAll(".theme-doc-sidebar-container a, .theme-doc-sidebar-container span")).map((el) => el.textContent || "").join("\\n");
    const toc = Array.from(document.querySelectorAll(".table-of-contents a")).map((el) => el.textContent || "").join("\\n");
    const article = Array.from(document.querySelectorAll("article h1, article h2, article p")).map((el) => el.textContent || "").join("\\n");
    return sidebar.includes("模块") && !sidebar.includes("XML Modules Configuration") && toc.includes("关于") && article.includes("关于");
  })()`;
}

function startContentTranslationExpression(expectedUrl, runId, settingsView) {
  return `new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      chrome.tabs.query({}, (tabs) => {
        const fallbackTabs = tabs.filter((candidate) => {
          const url = candidate.url || candidate.pendingUrl || "";
          return candidate.id && candidate.status === "complete" && !url.startsWith("chrome-extension://");
        });
        const tab = tabs.find((candidate) => {
          const url = candidate.url || candidate.pendingUrl || "";
          return url.startsWith(${JSON.stringify(expectedUrl)}) || (url.startsWith("https://developer.signalwire.com/") && candidate.status === "complete");
        }) ?? (fallbackTabs.length === 1 ? fallbackTabs[0] : undefined);
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, {
            type: "CONTENT_START_PAGE_TRANSLATION",
            runId: ${JSON.stringify(runId)},
            frameId: 0,
            settingsView: ${JSON.stringify(settingsView)}
          }, { frameId: 0 }, (response) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(response);
          });
          return;
        }
        if (Date.now() - started > 30000) {
          reject(new Error("tab missing: " + JSON.stringify(tabs.map((candidate) => ({ url: candidate.url, pendingUrl: candidate.pendingUrl, status: candidate.status })))));
          return;
        }
        setTimeout(tick, 250);
      });
    };
    tick();
  })`;
}

async function waitForCondition(page, expression, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await runtimeEvaluate(page, { returnByValue: true, expression });
    if (result.result.value) return;
    await wait(250);
  }
  throw new Error(`Condition timed out: ${expression}`);
}

async function runtimeEvaluate(target, params, attempts = 20) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await target.send("Runtime.evaluate", params);
    } catch (error) {
      lastError = error;
      if (!isRecoverableExecutionContextError(error)) throw error;
      await wait(250);
    }
  }
  throw lastError;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function listen(target, port) {
  return new Promise((resolve) => target.listen(port, "127.0.0.1", resolve));
}

async function waitForDebug() {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      return await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((res) => res.json());
    } catch {
      await wait(100);
    }
  }
  throw new Error("Chrome debug endpoint did not start");
}

async function waitForTargets(browser) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((res) => res.json());
    if (targets.some((target) => target.type === "service_worker" && isExtensionServiceWorker(target.url)) && targets.some((target) => target.url.startsWith(targetUrl))) {
      return targets;
    }
    await wait(250);
  }
  const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((res) => res.json());
  throw new Error(`Expected Chrome targets not found: ${describeTargets(list)}`);
}

function describeTargets(targets) {
  return JSON.stringify(targets.map((target) => ({ type: target.type, url: target.url })));
}

function isExtensionServiceWorker(url) {
  return /^chrome-extension:\/\//.test(url) && /(?:background\/service-worker|service_worker)\.js$/.test(url);
}

function isRecoverableExecutionContextError(error) {
  return error instanceof Error && /Execution context was destroyed|Cannot find context/i.test(error.message);
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  return {
    send(method, params = {}) {
      const requestId = ++id;
      socket.send(JSON.stringify({ id: requestId, method, params }));
      return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
    },
    close() {
      socket.close();
    }
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
