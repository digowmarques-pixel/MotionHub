import { useState, type FormEvent } from "react";
import { ASPECT_RATIOS, ASSET_TYPES, validateManifest, type FileRole } from "@motionhub/shared";
import { api, sha256File } from "../api";
import { Notice, errorText } from "../ui";

const EXAMPLE_PARAMS = `[
  { "key": "headline", "label": "Headline", "type": "string", "default": "MEGALUME", "maxLength": 120 },
  { "key": "primaryColor", "label": "Cor principal", "type": "color", "default": "#FFFFFF" },
  { "key": "durationSec", "label": "Duração", "type": "duration", "default": 3, "min": 0.5, "max": 20 }
]`;

const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const safeName = (name: string) => {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return `${slugify(dot > 0 ? name.slice(0, dot) : name) || "arquivo"}${ext ? `.${ext}` : ""}`;
};
function roleFor(file: File): FileRole {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["mogrt", "aep", "ffx"].includes(ext)) return "template";
  if (["wav", "mp3"].includes(ext)) return "audio";
  return "media";
}

interface Progress {
  step: string;
  done: number;
  total: number;
}

export function NewAsset() {
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const main = f.get("main") as File;
    const preview = f.get("preview") as File;
    const poster = f.get("poster") as File;
    if (!main?.size || !preview?.size || !poster?.size) return setError("Envie o arquivo principal, o preview e o poster.");

    let parameters: unknown = [];
    try {
      parameters = JSON.parse(String(f.get("parameters") || "[]"));
    } catch {
      return setError("Parâmetros: JSON inválido.");
    }
    const role = roleFor(main);
    const mainPath = `${role === "template" ? "template" : role}/${safeName(main.name)}`;
    const previewPath = `preview/${safeName(preview.name)}`;
    const posterExt = poster.name.split(".").pop()?.toLowerCase();
    const posterPath = `preview/poster.${posterExt}`;
    const files: Array<[string, File]> = [[mainPath, main], [previewPath, preview], [posterPath, poster]];

    setProgress({ step: "Calculando SHA-256…", done: 0, total: files.length + 2 });
    const hosts = [{ name: "premiere", minVersion: String(f.get("pproMin")) }];
    if (f.get("aeMin")) hosts.push({ name: "after-effects", minVersion: String(f.get("aeMin")) });
    const list = (k: string) => String(f.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const manifest = {
      schemaVersion: "1.0",
      id: slug,
      version: String(f.get("version")),
      name,
      type: String(f.get("type")),
      summary: String(f.get("summary") || "") || undefined,
      hosts,
      assets: [{ path: mainPath, sha256: await sha256File(main), role, bytes: main.size }],
      preview: { path: previewPath, poster: posterPath },
      parameters,
      aspectRatio: String(f.get("aspectRatio")),
      durationSec: Number(f.get("durationSec")) || undefined,
      language: String(f.get("language") || "") || undefined,
      license: String(f.get("license")),
      tags: list("tags"),
      synonyms: list("synonyms"),
      client: String(f.get("client") || "") || undefined,
    };
    const v = validateManifest(manifest);
    if (!v.ok) {
      setProgress(null);
      return setError(`Manifest inválido: ${v.issues.map((i) => `${i.path || "manifest"}: ${i.message}`).join("; ")}`);
    }
    try {
      setProgress({ step: "Criando rascunho…", done: 1, total: files.length + 2 });
      const created = await api<{ assetId: string; semver: string }>("POST", "/v1/admin/assets", {
        manifest,
        changelog: String(f.get("changelog") || "") || undefined,
        category: String(f.get("category") || "") || undefined,
      });
      let i = 1;
      for (const [path, file] of files) {
        setProgress({ step: `Enviando ${path}…`, done: ++i, total: files.length + 2 });
        await api("PUT", `/v1/admin/assets/${created.assetId}/versions/${created.semver}/files/${path}`, undefined, { raw: file });
      }
      if (f.get("submit")) {
        setProgress({ step: "Enviando para revisão…", done: files.length + 2, total: files.length + 2 });
        await api("POST", `/v1/admin/assets/${created.assetId}/versions/${created.semver}/submit`);
      }
      location.hash = `#/assets/${created.assetId}`;
    } catch (ex) {
      setError(errorText(ex));
      setProgress(null);
    }
  };

  return (
    <section>
      <header className="page-head">
        <h1>Novo asset ou nova versão</h1>
      </header>
      <p className="muted">
        Para uma nova versão de um asset existente, use o mesmo <b>ID</b> e uma versão maior (ex.: 1.1.0). Versões publicadas nunca são alteradas.
      </p>
      <form className="form card" onSubmit={submit}>
        <fieldset>
          <legend>Identificação</legend>
          <label>
            Nome
            <input required value={name} maxLength={120} onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} />
          </label>
          <label>
            ID (slug)
            <input required value={slug} pattern="[a-z0-9][a-z0-9\-]{2,79}" onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }} />
          </label>
          <div className="cols">
            <label>
              Tipo
              <select name="type" defaultValue="title">{ASSET_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            </label>
            <label>
              Versão
              <input name="version" required defaultValue="1.0.0" />
            </label>
            <label>
              Proporção
              <select name="aspectRatio" defaultValue="16:9">{ASPECT_RATIOS.map((t) => <option key={t}>{t}</option>)}</select>
            </label>
          </div>
          <label>
            Resumo
            <textarea name="summary" rows={2} maxLength={500} />
          </label>
          <div className="cols">
            <label>
              Tags (separe por vírgula)
              <input name="tags" placeholder="institucional, clean" />
            </label>
            <label>
              Sinônimos
              <input name="synonyms" placeholder="tarja, gc" />
            </label>
          </div>
          <div className="cols">
            <label>
              Cliente
              <input name="client" />
            </label>
            <label>
              Categoria
              <input name="category" />
            </label>
            <label>
              Idioma
              <input name="language" defaultValue="pt-BR" />
            </label>
            <label>
              Duração (s)
              <input name="durationSec" type="number" step="0.1" min="0" />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Compatibilidade e direitos</legend>
          <div className="cols">
            <label>
              Premiere mínimo
              <input name="pproMin" required defaultValue="25.6" />
            </label>
            <label>
              After Effects mínimo (opcional)
              <input name="aeMin" placeholder="26.0" />
            </label>
            <label>
              Licença
              <input name="license" required defaultValue="megalume-internal" />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Arquivos</legend>
          <label>
            Arquivo principal (.mogrt, .mp4, .mov, .wav, .mp3, .png…)
            <input name="main" type="file" required />
          </label>
          <div className="cols">
            <label>
              Preview (vídeo ou áudio; será padronizado no servidor)
              <input name="preview" type="file" accept="video/*,audio/*" required />
            </label>
            <label>
              Poster (imagem)
              <input name="poster" type="file" accept="image/png,image/jpeg,image/webp,audio/*" required />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Parâmetros editáveis (JSON)</legend>
          <p className="muted small">
            Tipos: string, richText, color, number, int, enum, bool, assetRef, font, duration, position, scale, easing. Use <code>hostParam</code> se o nome no Essential Graphics for diferente do label.
          </p>
          <textarea name="parameters" rows={8} className="mono" defaultValue={EXAMPLE_PARAMS} />
        </fieldset>
        <label>
          Changelog
          <textarea name="changelog" rows={2} />
        </label>
        <label className="check">
          <input type="checkbox" name="submit" defaultChecked /> Enviar para revisão ao concluir
        </label>
        <Notice kind="error">{error}</Notice>
        {progress ? (
          <div className="progress" role="status">
            <progress max={progress.total} value={progress.done} /> {progress.step}
          </div>
        ) : null}
        <button className="primary" disabled={!!progress}>
          Criar
        </button>
      </form>
    </section>
  );
}
