/**
 * Painel no navegador com Premiere simulado (desenvolvimento de UI e testes E2E).
 * Parâmetros de URL: ?project=0, ?sequence=0, ?host=25.0 para simular cenários.
 */
import { App } from "../src/ui/app.js";
import { HttpFolderLibrary, MemoryPlatform, MockPremiere } from "./mocks.js";

const q = new URLSearchParams(location.search);
const hostVersion = q.get("host") ?? "25.6.0";
const host = new MockPremiere(hostVersion);
host.hasProject = q.get("project") !== "0";
host.hasSequence = q.get("sequence") !== "0";
const platform = new MemoryPlatform(hostVersion, (...a) => fetch(...a), localStorage);
// ?pasta=1 simula a biblioteca no NAS usando a cópia em ./biblioteca (ver dev/make-listing.mjs).
if (q.get("pasta")) platform.folder = new HttpFolderLibrary(new URL("biblioteca", location.href).href.replace(/\/$/, ""));

(window as unknown as { __mock: unknown }).__mock = { host, platform };
void new App(document.getElementById("app")!, platform, host).start();
