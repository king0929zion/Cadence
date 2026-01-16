// src/main/preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("cadence", {
  ready: () => import_electron.ipcRenderer.invoke("cadence:ready"),
  settings: {
    get: () => import_electron.ipcRenderer.invoke("cadence:settings:get"),
    set: (partial) => import_electron.ipcRenderer.invoke("cadence:settings:set", partial)
  },
  sessions: {
    list: () => import_electron.ipcRenderer.invoke("cadence:sessions:list"),
    create: (title) => import_electron.ipcRenderer.invoke("cadence:sessions:create", title),
    messages: (sessionID, limit) => import_electron.ipcRenderer.invoke("cadence:sessions:messages", sessionID, limit),
    summarize: (sessionID) => import_electron.ipcRenderer.invoke("cadence:session:summarize", sessionID),
    export: (sessionID, filePath) => import_electron.ipcRenderer.invoke("cadence:session:export", { sessionID, filePath })
  },
  agents: {
    list: () => import_electron.ipcRenderer.invoke("cadence:agents:list")
  },
  providers: {
    list: () => import_electron.ipcRenderer.invoke("cadence:providers:list")
  },
  prompt: (input) => import_electron.ipcRenderer.invoke("cadence:prompt", input),
  permission: {
    respond: (input) => import_electron.ipcRenderer.invoke("cadence:permission:respond", input)
  },
  dialog: {
    save: (input) => import_electron.ipcRenderer.invoke("cadence:dialog:save", input)
  },
  onEvent: (cb) => {
    const handler = (_, event) => cb(event);
    import_electron.ipcRenderer.on("cadence:event", handler);
    return () => import_electron.ipcRenderer.off("cadence:event", handler);
  },
  onError: (cb) => {
    const handler = (_, err) => cb(err);
    import_electron.ipcRenderer.on("cadence:error", handler);
    return () => import_electron.ipcRenderer.off("cadence:error", handler);
  }
});

//# debugId=A90C305FA01A2AFF64756E2164756E21
//# sourceMappingURL=preload.cjs.map
