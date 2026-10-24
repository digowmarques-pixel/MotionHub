/** Ponto de entrada do painel UXP no Premiere Pro. */
import { App } from "./ui/app.js";
import { createUxpPlatform } from "./platform/uxp.js";
import { PremiereAdapter } from "./host/premiere.js";

declare const require: (m: string) => unknown;

async function boot(): Promise<void> {
  const root = document.getElementById("app")!;
  try {
    const platform = await createUxpPlatform();
    const ppro = require("premierepro") as ConstructorParameters<typeof PremiereAdapter>[0];
    const app = new App(root, platform, new PremiereAdapter(ppro, platform.hostVersion));
    await app.start();
  } catch (e) {
    root.textContent = `Falha ao iniciar o Motion Hub: ${(e as Error).message}`;
    console.error(e);
  }
}

void boot();
