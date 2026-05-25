import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import http from "node:http";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.slice(1));
const dist = resolve(root, "dist");
const extensionPath = dist.replaceAll("\\", "/");
const profile = resolve(root, ".tmp/chrome-profile");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const pagePort = 19090 + Math.floor(Math.random() * 1000);
const debugPort = 20000 + Math.floor(Math.random() * 20000);
const pageUrl = `http://127.0.0.1:${pagePort}/`;
const signalWireSourceUrl = "https://developer.signalwire.com/freeswitch/FreeSWITCH-Explained/Modules/mod_callcenter_1049389/";
let apiHits = 0;

if (!existsSync(dist)) throw new Error(`Missing dist: ${dist}`);
console.log("LOAD_EXTENSION", extensionPath);
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

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
    <html>
      <head>
        <title>SignalWire FreeSWITCH mod_callcenter fixture</title>
        <meta name="x-source-url" content="${signalWireSourceUrl}">
      </head>
      <body>
        <h1>Documentation</h1>
        <p id="intro">Hello <strong>world</strong></p>
        <p id="plain">Get started with the API</p>
        <button id="button">Submit</button>
        <div style="height: 2200px"></div>
        <h2 id="callcenter-heading">FreeSWITCH mod_callcenter</h2>
        <p id="callcenter-bottom">Callcenter queues route agents and callers.</p>
      </body>
    </html>`);
});

await listen(server, pagePort);

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
  pageUrl
], { stdio: "ignore" });

try {
  const version = await waitForDebug();
  const browser = await connectCdp(version.webSocketDebuggerUrl);
  const targets = await waitForTargets(browser);
  console.log("TARGETS", JSON.stringify(targets.map((target) => ({ type: target.type, url: target.url }))));
  const workerTarget = targets.find((target) => target.type === "service_worker" && isExtensionServiceWorker(target.url));
  const pageTarget = targets.find((target) => target.type === "page" && target.url === pageUrl);
  if (!workerTarget?.webSocketDebuggerUrl) {
    throw new Error(`Extension service worker target not found: ${JSON.stringify(targets.map((target) => ({ type: target.type, url: target.url })))}`);
  }
  console.log("WORKER_TARGET", workerTarget.url);
  if (!pageTarget?.webSocketDebuggerUrl) throw new Error("Test page target not found");

  const worker = await connectCdp(workerTarget.webSocketDebuggerUrl);
  const page = await connectCdp(pageTarget.webSocketDebuggerUrl);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await worker.send("Runtime.enable");
  await page.send("Page.reload", { ignoreCache: true });
  await wait(1000);

  await worker.send("Runtime.evaluate", {
    awaitPromise: true,
    expression: `chrome.storage.local.set({settings:${JSON.stringify({
      modelConfigs: [
        {
          id: "primary",
          name: "Mock",
          baseUrl: `http://127.0.0.1:${pagePort}/v1`,
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

  const startResult = await worker.send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `new Promise((resolve, reject) => {
      chrome.tabs.query({}, (tabs) => {
        const tab = tabs.find((candidate) => candidate.url && candidate.url.startsWith(${JSON.stringify(pageUrl)}));
        if (!tab?.id) { reject(new Error("tab missing: " + JSON.stringify(tabs.map(t => t.url)))); return; }
        chrome.tabs.sendMessage(tab.id, {
            type: "CONTENT_START_PAGE_TRANSLATION",
            runId: "smoke-run",
            frameId: 0,
            settingsView: { targetLanguage: "中文", maxCharsPerBatch: 12000 }
          }, {frameId: 0}, (response) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(response);
          });
      });
    })`
  });
  if (!startResult.result?.value?.ok) {
    throw new Error(`Content start failed: ${JSON.stringify(startResult)}`);
  }

  await wait(1500);
  const statusResult = await worker.send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        const tab = tabs.find((candidate) => candidate.url && candidate.url.startsWith(${JSON.stringify(pageUrl)}));
        if (!tab?.id) { resolve({error: "tab missing", tabs: tabs.map(t => t.url)}); return; }
        chrome.tabs.sendMessage(tab.id, {type: "QUERY_RUNNER_STATUS"}, {frameId: 0}, (response) => {
          resolve(chrome.runtime.lastError ? {error: chrome.runtime.lastError.message} : response);
        });
      });
    })`
  });
  const result = await page.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `({
      intro: document.querySelector("#intro")?.innerHTML,
      plain: document.querySelector("#plain")?.textContent,
      button: document.querySelector("#button")?.textContent
    })`
  });

  const value = result.result.value;
  console.log("RUNNER_STATUS", JSON.stringify(statusResult.result.value), "API_HITS", apiHits);
  if (value.intro !== "你好，<strong>世界</strong>") throw new Error(`safe-html translation failed: ${value.intro}`);
  if (value.plain !== "开始使用 API") throw new Error(`plain translation failed: ${value.plain}`);
  if (value.button !== "提交") throw new Error(`button translation failed: ${value.button}`);

  await page.send("Runtime.evaluate", {
    expression: "window.scrollTo(0, document.body.scrollHeight)"
  });
  await wait(1800);
  const scrolledResult = await page.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `({
      source: document.querySelector("meta[name='x-source-url']")?.content,
      heading: document.querySelector("#callcenter-heading")?.textContent,
      bottom: document.querySelector("#callcenter-bottom")?.textContent
    })`
  });
  const scrolledValue = scrolledResult.result.value;
  if (scrolledValue.source !== signalWireSourceUrl) throw new Error(`signalwire source url missing: ${scrolledValue.source}`);
  if (scrolledValue.heading !== "FreeSWITCH 呼叫中心模块") throw new Error(`scroll heading translation failed: ${scrolledValue.heading}`);
  if (scrolledValue.bottom !== "呼叫中心队列路由座席和呼叫者。") throw new Error(`scroll bottom translation failed: ${scrolledValue.bottom}`);
  console.log("SMOKE_OK", JSON.stringify({ initial: value, scrolled: scrolledValue }));
  await worker.close();
  await page.close();
  await browser.close();
} finally {
  server.close();
  await wait(1000);
  chrome.kill();
}

function translate(text) {
  if (text === "Hello <strong>world</strong>") return "你好，<strong>世界</strong>";
  if (text === "Get started with the API") return "开始使用 API";
  if (text === "Submit") return "提交";
  if (text === "Documentation") return "文档";
  if (text === "FreeSWITCH mod_callcenter") return "FreeSWITCH 呼叫中心模块";
  if (text === "Callcenter queues route agents and callers.") return "呼叫中心队列路由座席和呼叫者。";
  return `译文:${text}`;
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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((res) => res.json());
    if (targets.some((target) => target.type === "service_worker" && isExtensionServiceWorker(target.url)) && targets.some((target) => target.url === pageUrl)) {
      return targets;
    }
    await wait(100);
  }
  const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((res) => res.json());
  throw new Error(`Expected Chrome targets not found: ${JSON.stringify(list.map((target) => ({ type: target.type, url: target.url })))}`);
}

function isExtensionServiceWorker(url) {
  return /^chrome-extension:\/\//.test(url) && /(?:background\/service-worker|service_worker)\.js$/.test(url);
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
