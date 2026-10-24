/**
 * Adaptador Premiere Pro (UXP). Usa apenas a API oficial `premierepro`
 * (tipos: @adobe/premierepro). Pontos marcados com POC dependem de validação
 * em Premiere real na Fase 0 — ver docs/fase0-matriz-api.md.
 */
import type { premierepro } from "@adobe/premierepro";
import type { Project, Sequence, ProjectItem, TickTime, ComponentParam, Action } from "@adobe/premierepro";
import { ApplyError } from "@motionhub/shared";
import type { HostAdapter, HostContext, HostParamValue, InsertOptions, InsertResult } from "./types.js";

type Ppro = premierepro;
const BIN_NAME = "Megalume Motion Hub";

export class PremiereAdapter implements HostAdapter {
  constructor(
    private readonly p: Ppro,
    private readonly hostVersion: string,
  ) {}

  private async active(): Promise<{ project: Project | null; sequence: Sequence | null }> {
    let project: Project | null = null;
    try {
      project = await this.p.Project.getActiveProject();
    } catch {
      project = null;
    }
    if (!project) return { project: null, sequence: null };
    let sequence: Sequence | null = null;
    try {
      sequence = (await project.getActiveSequence()) ?? null;
    } catch {
      sequence = null;
    }
    return { project, sequence };
  }

  async getContext(): Promise<HostContext> {
    const { project, sequence } = await this.active();
    const ctx: HostContext = { host: "premiere", hostVersion: this.hostVersion, project: project ? { name: project.name } : null, sequence: null };
    if (sequence) {
      const settings = await sequence.getSettings();
      const rect = await settings.getVideoFrameRect();
      ctx.sequence = {
        name: sequence.name,
        fps: settings.getVideoFrameRate().value,
        width: rect.width,
        height: rect.height,
        playheadSec: (await sequence.getPlayerPosition()).seconds,
        durationSec: (await sequence.getEndTime()).seconds,
        videoTracks: await sequence.getVideoTrackCount(),
        audioTracks: await sequence.getAudioTrackCount(),
      };
    }
    return ctx;
  }

  private async require(): Promise<{ project: Project; sequence: Sequence }> {
    const { project, sequence } = await this.active();
    if (!project) throw new ApplyError("host_no_project");
    if (!sequence) throw new ApplyError("host_no_sequence");
    return { project, sequence };
  }

  private async timeFor(sequence: Sequence, at: InsertOptions["at"]): Promise<TickTime> {
    if (at === "playhead") return sequence.getPlayerPosition();
    if (at === "start") return this.p.TickTime.createWithSeconds(0);
    return this.p.TickTime.createWithSeconds(at);
  }

  /** Executa ações como UMA etapa de Desfazer. */
  private transaction(project: Project, actions: Action[], undo: string): void {
    let ok = false;
    project.lockedAccess(() => {
      ok = project.executeTransaction((compound) => {
        for (const a of actions) compound.addAction(a);
      }, undo);
    });
    if (!ok) throw new ApplyError("host_api_error", `O Premiere recusou a operação "${undo}".`);
  }

  async insertMogrt(path: string, opts: InsertOptions, params: HostParamValue[], label: string): Promise<InsertResult> {
    const { project, sequence } = await this.require();
    const editor = this.p.SequenceEditor.getEditor(sequence);
    const time = await this.timeFor(sequence, opts.at);
    let items: unknown[] = [];
    try {
      // POC: insertMogrtFromPath não é Action; cria sua própria etapa de Desfazer.
      project.lockedAccess(() => {
        items = editor.insertMogrtFromPath(path, time, opts.videoTrack, opts.audioTrack) ?? [];
      });
    } catch (e) {
      throw mapHostError(e);
    }
    if (!items.length) throw new ApplyError("host_api_error", "O MOGRT não foi inserido (nenhum item criado).");

    const warnings: string[] = [];
    if (params.length) {
      const actions: Action[] = [];
      const video = items.find((i) => typeof (i as { getComponentChain?: unknown }).getComponentChain === "function") as
        | { getComponentChain(): Promise<{ getComponentCount(): number; getComponentAtIndex(i: number): { getParamCount(): number; getParam(i: number): ComponentParam } }>; getStartTime(): Promise<TickTime>; createSetEndAction(t: TickTime): Action }
        | undefined;
      if (!video) {
        warnings.push("Item de vídeo não encontrado para aplicar parâmetros.");
      } else {
        const byName = new Map<string, ComponentParam>();
        const chain = await video.getComponentChain();
        for (let c = 0; c < chain.getComponentCount(); c++) {
          const comp = chain.getComponentAtIndex(c);
          for (let i = 0; i < comp.getParamCount(); i++) {
            const prm = comp.getParam(i);
            const key = normalizeName(prm.displayName);
            if (!byName.has(key)) byName.set(key, prm);
          }
        }
        for (const pv of params) {
          if (pv.type === "duration") {
            const start = await video.getStartTime();
            actions.push(video.createSetEndAction(start.add(this.p.TickTime.createWithSeconds(Number(pv.value)))));
            continue;
          }
          const prm = byName.get(normalizeName(pv.name));
          if (!prm) {
            warnings.push(`Parâmetro "${pv.name}" não existe neste template.`);
            continue;
          }
          try {
            actions.push(prm.createSetValueAction(prm.createKeyframe(this.toHostValue(pv) as never), true));
          } catch (e) {
            warnings.push(`Não foi possível definir "${pv.name}": ${(e as Error).message}`);
          }
        }
      }
      if (actions.length) {
        try {
          this.transaction(project, actions, `Motion Hub: parâmetros de ${label}`);
        } catch (e) {
          warnings.push(`Parâmetros não aplicados: ${(e as Error).message}`);
        }
      }
    }
    return { trackItems: items.length, warnings };
  }

  /** Converte valor do esquema (§6.1) para o tipo esperado por createKeyframe. */
  private toHostValue(pv: HostParamValue): unknown {
    const p = this.p as Ppro & { MogrtText?: new () => { setText(t: string): boolean } };
    switch (pv.type) {
      case "string":
      case "richText": {
        // Premiere 27+: parâmetros de texto de MOGRT usam MogrtText. Em 26.x, string (POC).
        if (p.MogrtText) {
          const t = new p.MogrtText();
          t.setText(String(pv.value));
          return t;
        }
        return String(pv.value);
      }
      case "color": {
        const { r, g, b, a } = hexToRgba(String(pv.value));
        return new this.p.Color(r, g, b, a);
      }
      case "position": {
        const [x, y] = pv.value as [number, number];
        return new this.p.PointF(x, y);
      }
      case "bool":
        return Boolean(pv.value);
      case "enum":
      case "font":
        return String(pv.value);
      default:
        return Number(pv.value);
    }
  }

  async insertMedia(path: string, opts: InsertOptions, label: string): Promise<InsertResult> {
    const { project, sequence } = await this.require();
    const item = await this.importOnce(project, path);
    const time = await this.timeFor(sequence, opts.at);
    const editor = this.p.SequenceEditor.getEditor(sequence);
    let action: Action;
    try {
      action =
        opts.mode === "insert"
          ? editor.createInsertProjectItemAction(item, time, opts.videoTrack, opts.audioTrack, false)
          : editor.createOverwriteItemAction(item, time, opts.videoTrack, opts.audioTrack);
      this.transaction(project, [action], `Motion Hub: inserir ${label}`);
    } catch (e) {
      throw mapHostError(e);
    }
    return { trackItems: 1, warnings: [] };
  }

  /** Importa para a pasta "Megalume Motion Hub", reaproveitando item já importado do mesmo arquivo. */
  private async importOnce(project: Project, path: string): Promise<ProjectItem> {
    const bin = await this.ensureBin(project);
    const found = await this.findByPath(bin, path);
    if (found) return found;
    const ok = await project.importFiles([path], true, bin as unknown as ProjectItem);
    if (!ok) throw new ApplyError("host_api_error", "O Premiere não conseguiu importar o arquivo.");
    const imported = await this.findByPath(bin, path);
    if (!imported) throw new ApplyError("host_api_error", "Arquivo importado, mas não localizado no projeto.");
    return imported;
  }

  private async ensureBin(project: Project) {
    const root = await project.getRootItem();
    const find = async () => (await root.getItems()).find((i) => i.name === BIN_NAME && i.type === this.p.ProjectItem.TYPE_BIN);
    let bin = await find();
    if (!bin) {
      this.transaction(project, [root.createBinAction(BIN_NAME, false)], "Motion Hub: criar pasta");
      bin = await find();
    }
    if (!bin) throw new ApplyError("host_api_error", "Não foi possível criar a pasta do Motion Hub no projeto.");
    return this.p.FolderItem.cast(bin);
  }

  private async findByPath(bin: { getItems(): Promise<ProjectItem[]> }, path: string): Promise<ProjectItem | null> {
    const want = normalizePath(path);
    for (const it of await bin.getItems()) {
      if (it.type !== this.p.ProjectItem.TYPE_CLIP && it.type !== this.p.ProjectItem.TYPE_FILE) continue;
      try {
        const clip = this.p.ClipProjectItem.cast(it);
        if (normalizePath(await clip.getMediaFilePath()) === want) return it;
      } catch {
        /* item sem mídia */
      }
    }
    return null;
  }
}

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const normalizePath = (p: string) => p.replace(/\\/g, "/").toLowerCase();

export function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } {
  const h = hex.replace("#", "");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
}

/** Traduz erros do host para códigos da máquina de estados (§7.1). */
export function mapHostError(e: unknown): ApplyError {
  if (e instanceof ApplyError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (/lock|bloquead/i.test(msg)) return new ApplyError("track_locked", msg);
  return new ApplyError("host_api_error", msg);
}
