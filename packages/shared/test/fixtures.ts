export const validManifest = {
  schemaVersion: "1.0",
  id: "meg-title-rise-001",
  version: "1.2.0",
  name: "Título Rise Institucional",
  type: "title",
  hosts: [
    { name: "premiere", minVersion: "25.6" },
    { name: "after-effects", minVersion: "26.0" },
  ],
  assets: [{ path: "template/title.mogrt", sha256: "a".repeat(64), role: "template" }],
  preview: { path: "preview/loop.mp4", poster: "preview/poster.webp" },
  parameters: [
    { key: "headline", type: "string", default: "MEGALUME", maxLength: 120 },
    { key: "primaryColor", type: "color", default: "#FFFFFF" },
    { key: "durationSec", type: "number", min: 0.5, max: 20, default: 3 },
  ],
  license: "megalume-internal",
  tags: ["title", "institutional", "clean"],
};
