var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: () => mod[key],
        enumerable: true
      });
  return to;
};

// src/main/main.ts
var import_electron = require("electron");
var import_node_path2 = __toESM(require("node:path"));
var import_node_fs = __toESM(require("node:fs"));
var import_promises = __toESM(require("node:fs/promises"));

// src/main/opencode-server.ts
var import_node_child_process = require("node:child_process");
var import_node_path = __toESM(require("node:path"));

class OpencodeServerManager {
  opencodeRoot;
  #child;
  #info;
  #starting;
  constructor(opencodeRoot) {
    this.opencodeRoot = opencodeRoot;
  }
  get info() {
    return this.#info;
  }
  async start() {
    if (this.#info)
      return this.#info;
    if (this.#starting)
      return this.#starting;
    const opencodeCwd = import_node_path.default.join(this.opencodeRoot, "packages", "opencode");
    this.#starting = new Promise((resolve, reject) => {
      const child = import_node_child_process.spawn("bun", ["run", "src/index.ts", "serve", "--hostname", "127.0.0.1", "--port", "0"], {
        cwd: opencodeCwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env }
      });
      this.#child = child;
      let settled = false;
      const fail = (err) => {
        if (settled)
          return;
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      const tryParse = (chunk) => {
        const text = chunk.toString("utf8");
        const match = text.match(/opencode server listening on (http:\/\/[^\s]+)/i);
        if (!match)
          return;
        const baseUrl = match[1];
        const info = { baseUrl, opencodeCwd };
        this.#info = info;
        if (!settled) {
          settled = true;
          resolve(info);
        }
      };
      child.stdout.on("data", tryParse);
      child.stderr.on("data", (d) => {
        process.stderr.write(d);
      });
      child.on("error", fail);
      child.on("exit", (code) => {
        if (!settled)
          fail(new Error(`opencode serve 已退出（code=${code}）`));
      });
      setTimeout(() => {
        if (!settled)
          fail(new Error("启动 opencode serve 超时（10s），请确认已安装 bun 且 opencode 依赖已安装"));
      }, 1e4);
    }).finally(() => {
      this.#starting = undefined;
    });
    return this.#starting;
  }
  async stop() {
    const child = this.#child;
    this.#child = undefined;
    this.#info = undefined;
    this.#starting = undefined;
    if (!child)
      return;
    if (child.killed)
      return;
    child.kill();
  }
}

// src/main/opencode-http.ts
function withDirectory(url, directory) {
  const u = new URL(url);
  u.searchParams.set("directory", directory);
  return u.toString();
}
async function readJson(res) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return await res.json();
}

class OpencodeHttpClient {
  baseUrl;
  directory;
  constructor(baseUrl, directory) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.directory = directory;
  }
  getBaseUrl() {
    return this.baseUrl;
  }
  setBaseUrl(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }
  setDirectory(directory) {
    this.directory = directory;
  }
  async getConfig() {
    const res = await fetch(withDirectory(`${this.baseUrl}/config`, this.directory));
    return readJson(res);
  }
  async listSessions(input) {
    const u = new URL(withDirectory(`${this.baseUrl}/session`, this.directory));
    if (input?.search)
      u.searchParams.set("search", input.search);
    if (input?.limit !== undefined)
      u.searchParams.set("limit", String(input.limit));
    if (input?.roots !== undefined)
      u.searchParams.set("roots", String(input.roots));
    const res = await fetch(u.toString());
    return readJson(res);
  }
  async createSession(body) {
    const res = await fetch(withDirectory(`${this.baseUrl}/session`, this.directory), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {})
    });
    return readJson(res);
  }
  async getSessionMessages(sessionID, limit) {
    const u = new URL(withDirectory(`${this.baseUrl}/session/${encodeURIComponent(sessionID)}/message`, this.directory));
    if (limit !== undefined)
      u.searchParams.set("limit", String(limit));
    const res = await fetch(u.toString());
    return readJson(res);
  }
  async prompt(sessionID, body) {
    const res = await fetch(withDirectory(`${this.baseUrl}/session/${encodeURIComponent(sessionID)}/message`, this.directory), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return readJson(res);
  }
  async summarize(sessionID, body) {
    const res = await fetch(withDirectory(`${this.baseUrl}/session/${encodeURIComponent(sessionID)}/summarize`, this.directory), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return readJson(res);
  }
  async listAgents() {
    const res = await fetch(withDirectory(`${this.baseUrl}/agent`, this.directory));
    return readJson(res);
  }
  async listProviders() {
    const res = await fetch(withDirectory(`${this.baseUrl}/provider`, this.directory));
    return readJson(res);
  }
  async replyPermission(requestID, reply, message) {
    const res = await fetch(withDirectory(`${this.baseUrl}/permission/${encodeURIComponent(requestID)}/reply`, this.directory), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply, message })
    });
    return readJson(res);
  }
  async* subscribeEvents(signal) {
    const res = await fetch(withDirectory(`${this.baseUrl}/event`, this.directory), {
      headers: { Accept: "text/event-stream" },
      signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`订阅事件失败：HTTP ${res.status}: ${text || res.statusText}`);
    }
    if (!res.body)
      throw new Error("订阅事件失败：响应体为空");
    const reader = res.body.getReader();
    const decoder = new TextDecoder;
    let buf = "";
    for (;; ) {
      const { value, done } = await reader.read();
      if (done)
        break;
      buf += decoder.decode(value, { stream: true });
      for (;; ) {
        const idx = buf.indexOf(`

`);
        if (idx === -1)
          break;
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const lines = raw.split(`
`);
        const dataLines = lines.map((l) => l.trimEnd()).filter((l) => l.startsWith("data:")).map((l) => l.slice("data:".length).trimStart());
        if (dataLines.length === 0)
          continue;
        const data = dataLines.join(`
`);
        try {
          yield JSON.parse(data);
        } catch {}
      }
    }
  }
}

// src/main/main.ts
var __dirname = "G:\\Open-AutoGLM\\Cadence\\cadence\\src\\main";
var DEFAULT_SETTINGS = {
  directory: process.cwd(),
  serverMode: "auto",
  serverUrl: "http://127.0.0.1:4096",
  autoLaunch: false,
  hotkey: "Control+Alt+Space",
  permissionMemory: {}
};
var userData = import_electron.app.getPath("userData");
var settingsPath = import_node_path2.default.join(userData, "cadence.settings.json");
async function readSettings() {
  try {
    const raw = await import_promises.default.readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed, permissionMemory: parsed.permissionMemory ?? {} };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
async function writeSettings(next) {
  await import_promises.default.mkdir(userData, { recursive: true });
  await import_promises.default.writeFile(settingsPath, JSON.stringify(next, null, 2), "utf8");
}
function createTrayIcon() {
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAO0lEQVR4AWP4z8Dwn4GBgYHh////h4GBgYHBgYGB4T8DAwMDA8N/GBgYGBgYAAApPwpb1mGkVQAAAABJRU5ErkJggg==";
  return import_electron.nativeImage.createFromBuffer(Buffer.from(pngBase64, "base64"));
}
function resolveOpencodeRoot() {
  const fromEnv = process.env.CADENCE_OPENCODE_ROOT;
  if (fromEnv && import_node_fs.default.existsSync(fromEnv))
    return fromEnv;
  const candidates = [
    import_node_path2.default.resolve(process.cwd(), "..", "opencode"),
    import_node_path2.default.resolve(import_electron.app.getAppPath(), "..", "..", "opencode"),
    import_node_path2.default.resolve(import_electron.app.getAppPath(), "..", "opencode")
  ];
  for (const c of candidates) {
    if (import_node_fs.default.existsSync(import_node_path2.default.join(c, "packages", "opencode", "src", "index.ts")))
      return c;
  }
  throw new Error("未找到同级 opencode 目录，请设置 CADENCE_OPENCODE_ROOT");
}
var win;
var tray;
var settings;
var client;
var server;
var eventsAbort;
var pendingPermissions = new Map;
function getClient() {
  if (!client)
    throw new Error("OpenCode 服务未就绪");
  return client;
}
async function ensureServerReady() {
  if (settings.serverMode === "attach") {
    const baseUrl = settings.serverUrl.replace(/\/+$/, "");
    if (!client)
      client = new OpencodeHttpClient(baseUrl, settings.directory);
    else
      client.setBaseUrl(baseUrl);
    client.setDirectory(settings.directory);
    return { baseUrl, opencodeCwd: "" };
  }
  try {
    if (!server)
      server = new OpencodeServerManager(resolveOpencodeRoot());
    const info = await server.start();
    if (!client)
      client = new OpencodeHttpClient(info.baseUrl, settings.directory);
    else
      client.setBaseUrl(info.baseUrl);
    client.setDirectory(settings.directory);
    return info;
  } catch (e) {
    const baseUrl = settings.serverUrl.replace(/\/+$/, "");
    if (!client)
      client = new OpencodeHttpClient(baseUrl, settings.directory);
    else
      client.setBaseUrl(baseUrl);
    client.setDirectory(settings.directory);
    win?.webContents.send("cadence:error", {
      message: "自动启动 opencode 失败，已回退为“连接已有服务”。原因：" + (e instanceof Error ? e.message : String(e))
    });
    return { baseUrl, opencodeCwd: "" };
  }
}
async function maybeAutoApprovePermission(req) {
  const memory = settings.permissionMemory[req.permission] ?? [];
  const always = Array.isArray(req.always) ? req.always : [];
  if (always.length === 0)
    return false;
  const ok = always.every((p) => memory.includes(p));
  if (!ok)
    return false;
  await getClient().replyPermission(req.id, "always");
  return true;
}
async function restartEventStream() {
  eventsAbort?.abort();
  eventsAbort = new AbortController;
  const abortSignal = eventsAbort.signal;
  (async () => {
    for await (const event of getClient().subscribeEvents(abortSignal)) {
      if (abortSignal.aborted)
        break;
      if (event.type === "permission.asked") {
        pendingPermissions.set(event.properties.id, {
          permission: event.properties.permission,
          always: event.properties.always ?? []
        });
        const auto = await maybeAutoApprovePermission(event.properties).catch(() => false);
        if (auto)
          continue;
      }
      win?.webContents.send("cadence:event", event);
      if (event.type === "session.idle") {
        if (import_electron.Notification.isSupported()) {
          const isFocused = win?.isFocused() ?? false;
          if (!isFocused)
            new import_electron.Notification({ title: "Cadence", body: "任务已完成" }).show();
        }
      }
    }
  })().catch((e) => {
    win?.webContents.send("cadence:error", { message: e instanceof Error ? e.message : String(e) });
  });
}
function createWindow() {
  win = new import_electron.BrowserWindow({
    width: 1100,
    height: 720,
    backgroundColor: "#f5f1e8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: import_node_path2.default.join(__dirname, "preload.cjs")
    }
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl)
    win.loadURL(devUrl);
  else
    win.loadFile(import_node_path2.default.join(__dirname, "renderer", "index.html"));
  win.on("close", (e) => {
    if (tray && !import_electron.app.isQuiting) {
      e.preventDefault();
      win?.hide();
    }
  });
}
function ensureTray() {
  if (tray)
    return;
  tray = new import_electron.Tray(createTrayIcon());
  const menu = import_electron.Menu.buildFromTemplate([
    {
      label: "显示/隐藏",
      click: () => {
        if (!win)
          return;
        if (win.isVisible())
          win.hide();
        else {
          win.show();
          win.focus();
        }
      }
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        import_electron.app.isQuiting = true;
        import_electron.app.quit();
      }
    }
  ]);
  tray.setToolTip("Cadence");
  tray.setContextMenu(menu);
  tray.on("double-click", () => {
    win?.show();
    win?.focus();
  });
}
function applyAutoLaunch(enabled) {
  if (process.platform !== "win32")
    return;
  import_electron.app.setLoginItemSettings({ openAtLogin: enabled });
}
function applyHotkey(hotkey) {
  import_electron.globalShortcut.unregisterAll();
  if (!hotkey)
    return;
  try {
    import_electron.globalShortcut.register(hotkey, () => {
      if (!win)
        return;
      if (win.isVisible())
        win.hide();
      else {
        win.show();
        win.focus();
      }
    });
  } catch {}
}
async function exportSessionMarkdown(sessionID, filePath) {
  const data = await getClient().getSessionMessages(sessionID);
  let out = `# Cadence 导出

- Session: ${sessionID}
- 时间: ${new Date().toLocaleString()}

---

`;
  for (const msg of data) {
    const role = msg.info.role;
    out += role === "user" ? `## 用户

` : `## 助手

`;
    const text = msg.parts.filter((p) => p.type === "text").map((p) => p.text).join("");
    if (text.trim())
      out += text.trim() + `

`;
    const tools = msg.parts.filter((p) => p.type === "tool");
    for (const t of tools) {
      out += `
\`\`\`
tool: ${t.tool}
${t.state?.title ?? ""}
\`\`\`
`;
      const o = t.state?.output;
      if (typeof o === "string" && o.trim())
        out += `
\`\`\`
${o.trim()}
\`\`\`
`;
    }
    out += `
---

`;
  }
  await import_promises.default.writeFile(filePath, out, "utf8");
}
import_electron.app.whenReady().then(async () => {
  import_electron.app.setAppUserModelId("ai.opencode.cadence");
  settings = await readSettings();
  ensureTray();
  applyAutoLaunch(settings.autoLaunch);
  applyHotkey(settings.hotkey);
  createWindow();
  try {
    await ensureServerReady();
    await restartEventStream();
  } catch (e) {
    win?.webContents.send("cadence:error", { message: e instanceof Error ? e.message : String(e) });
  }
  import_electron.ipcMain.handle("cadence:ready", async () => {
    const info = await ensureServerReady();
    await restartEventStream();
    return { ...info, directory: settings.directory };
  });
  import_electron.ipcMain.handle("cadence:settings:get", async () => {
    const { permissionMemory: _pm, ...publicSettings } = settings;
    return publicSettings;
  });
  import_electron.ipcMain.handle("cadence:settings:set", async (_e, partial) => {
    const prevMode = settings.serverMode;
    const prevUrl = settings.serverUrl;
    settings = { ...settings, ...partial, permissionMemory: settings.permissionMemory };
    await writeSettings(settings);
    applyAutoLaunch(settings.autoLaunch);
    applyHotkey(settings.hotkey);
    try {
      const modeChanged = prevMode !== settings.serverMode;
      const urlChanged = prevUrl !== settings.serverUrl;
      if (modeChanged || urlChanged) {
        eventsAbort?.abort();
        if (prevMode === "auto" && settings.serverMode === "attach") {
          await server?.stop().catch(() => {});
          server = undefined;
        }
      }
      await ensureServerReady();
      await restartEventStream();
    } catch (e) {
      win?.webContents.send("cadence:error", { message: e instanceof Error ? e.message : String(e) });
    }
    const { permissionMemory: _pm, ...publicSettings } = settings;
    return publicSettings;
  });
  import_electron.ipcMain.handle("cadence:sessions:list", async () => {
    return await getClient().listSessions({ limit: 200, roots: false });
  });
  import_electron.ipcMain.handle("cadence:sessions:create", async (_e, title) => {
    const permission = [
      { permission: "bash", pattern: "*", action: "ask" },
      { permission: "edit", pattern: "*", action: "ask" },
      { permission: "webfetch", pattern: "*", action: "ask" },
      { permission: "websearch", pattern: "*", action: "ask" },
      { permission: "question", pattern: "*", action: "allow" }
    ];
    return await getClient().createSession({ title: title || "新对话", permission });
  });
  import_electron.ipcMain.handle("cadence:sessions:messages", async (_e, sessionID, limit) => {
    return await getClient().getSessionMessages(sessionID, limit);
  });
  import_electron.ipcMain.handle("cadence:agents:list", async () => {
    return await getClient().listAgents();
  });
  import_electron.ipcMain.handle("cadence:providers:list", async () => {
    const raw = await getClient().listProviders();
    const all = Array.isArray(raw?.all) ? raw.all : [];
    return all.map((p) => {
      const id = p.id ?? p.providerID ?? p.name;
      const modelsObj = p.models ?? {};
      const models = Array.isArray(modelsObj) ? modelsObj : Object.values(modelsObj);
      return { id, models: models.map((m) => ({ id: m.id ?? m.modelID ?? m.name })).filter((m) => m.id) };
    });
  });
  import_electron.ipcMain.handle("cadence:prompt", async (_e, input) => {
    await getClient().prompt(input.sessionID, {
      model: input.model,
      agent: input.agent,
      variant: input.variant,
      parts: [{ type: "text", text: input.text }]
    });
    return true;
  });
  import_electron.ipcMain.handle("cadence:permission:respond", async (_e, input) => {
    if (input.response === "always") {
      const pending = pendingPermissions.get(input.permissionID);
      if (pending) {
        const existing = settings.permissionMemory[pending.permission] ?? [];
        const next = Array.from(new Set([...existing, ...pending.always ?? []]));
        settings.permissionMemory[pending.permission] = next;
        await writeSettings(settings);
      }
    }
    pendingPermissions.delete(input.permissionID);
    await getClient().replyPermission(input.permissionID, input.response);
    return true;
  });
  import_electron.ipcMain.handle("cadence:session:summarize", async (_e, sessionID) => {
    const model = await (async () => {
      if (settings.model)
        return settings.model;
      const cfg = await getClient().getConfig().catch(() => {
        return;
      });
      const m = cfg?.model;
      if (typeof m === "string" && m.includes("/")) {
        const [providerID, modelID] = m.split("/");
        if (providerID && modelID)
          return { providerID, modelID };
      }
      const providers = await getClient().listProviders().catch(() => {
        return;
      });
      const defaults = providers?.default;
      const firstProviderID = defaults ? Object.keys(defaults)[0] : undefined;
      const firstModelID = firstProviderID ? defaults[firstProviderID] : undefined;
      if (firstProviderID && firstModelID)
        return { providerID: firstProviderID, modelID: firstModelID };
      throw new Error("无法解析用于 compact 的默认模型，请在设置里选择模型");
    })();
    return await getClient().summarize(sessionID, { providerID: model.providerID, modelID: model.modelID, auto: false });
  });
  import_electron.ipcMain.handle("cadence:session:export", async (_e, input) => {
    await exportSessionMarkdown(input.sessionID, input.filePath);
    return true;
  });
  import_electron.ipcMain.handle("cadence:dialog:save", async (_e, input) => {
    const result = await import_electron.dialog.showSaveDialog(win, {
      title: input.title,
      defaultPath: input.defaultPath,
      filters: input.filters
    });
    return { canceled: result.canceled, filePath: result.filePath };
  });
});
import_electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin")
    return;
  import_electron.app.quit();
});
import_electron.app.on("before-quit", async () => {
  eventsAbort?.abort();
  await server?.stop();
});

//# debugId=4E43752FDCA13CF664756E2164756E21
//# sourceMappingURL=main.cjs.map
