import { loadConfig, type Config } from "./config.js";
import { createPool } from "./db.js";
import { LocalStorage } from "./storage.js";
import { createPackSigner } from "./crypto.js";
import type { AppContext } from "./context.js";

export function createContext(overrides: Partial<Config> = {}): AppContext {
  const config = loadConfig(overrides);
  return {
    config,
    db: createPool(config.databaseUrl),
    storage: new LocalStorage(config.storageDir),
    signer: config.packSigningKeyPem ? createPackSigner(config.packSigningKeyPem) : null,
  };
}
