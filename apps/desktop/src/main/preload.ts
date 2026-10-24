/** Ponte mínima e tipada entre a janela e o processo principal. */
import { contextBridge, ipcRenderer } from "electron";
import type { MotionHubBridge } from "../core/bridge.js";

const call = (ch: string) => (...a: unknown[]) => ipcRenderer.invoke(ch, ...a);

const bridge: MotionHubBridge = {
  session: call("mh:session") as MotionHubBridge["session"],
  login: call("mh:login") as MotionHubBridge["login"],
  logout: call("mh:logout") as MotionHubBridge["logout"],
  list: call("mh:list") as MotionHubBridge["list"],
  install: call("mh:install") as MotionHubBridge["install"],
  installAll: call("mh:installAll") as MotionHubBridge["installAll"],
  cancel: call("mh:cancel") as MotionHubBridge["cancel"],
  uninstall: call("mh:uninstall") as MotionHubBridge["uninstall"],
  rollback: call("mh:rollback") as MotionHubBridge["rollback"],
  settings: call("mh:settings") as MotionHubBridge["settings"],
  chooseLibraryDir: call("mh:chooseLibraryDir") as MotionHubBridge["chooseLibraryDir"],
  purgeOldVersions: call("mh:purge") as MotionHubBridge["purgeOldVersions"],
  openLibraryFolder: call("mh:openLibrary") as MotionHubBridge["openLibraryFolder"],
  exportDiagnostics: call("mh:exportDiagnostics") as MotionHubBridge["exportDiagnostics"],
  sendDiagnostics: call("mh:sendDiagnostics") as MotionHubBridge["sendDiagnostics"],
  library: call("mh:library") as MotionHubBridge["library"],
  onProgress(cb) {
    const l = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p);
    ipcRenderer.on("mh:progress", l);
    return () => ipcRenderer.off("mh:progress", l);
  },
  onChanged(cb) {
    const l = () => cb();
    ipcRenderer.on("mh:changed", l);
    return () => ipcRenderer.off("mh:changed", l);
  },
};

contextBridge.exposeInMainWorld("motionhub", bridge);
