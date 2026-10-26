/**
 * Adaptador Premiere Pro (UXP). Usa apenas a API oficial `premierepro`
 * (tipos: @adobe/premierepro). Pontos marcados com POC dependem de validação
 * em Premiere real na Fase 0 — ver docs/fase0-matriz-api.md.
 */
import type { premierepro } from "@adobe/premierepro";
import type { Project, Sequence, ProjectItem, TickTime, ComponentParam, Action } from "@adobe/premierepro";
import { ApplyError, type BlendMode } from "@motionhub/shared";
import type { HostAdapter, HostContext, HostParamValue, InsertOptions, InsertResult, MotionJob, MotionResult } from "./types.js";
import { MotionApplier } from "./premiere-motion.js";

type Ppro = premierepro;
const BIN_NAME = "Megalume Motion Hub";
const OPACITY_MATCH = "AE.ADBE Opacity";

/**
 * Índice de cada modo no parâmetro "Modo de mesclagem": ordem alfabética (em inglês) com
 * Subtract e Divide no fim; Normal = 18. Fonte: mapeamento por renderização no Premiere 25.2
 * (projeto Osiris-Premiere-MCP, licença MIT). Conferido em tempo de execução (ver lookActions).
 */
export const PREMIERE_BLEND: Record<BlendMode, number> = { normal: 18, screen: 22, overlay: 19, "soft-light": 23, multiply: 17, "linear-dodge": 14 };
const BLEND_LABEL: Record<BlendMode, string> = { normal: "Normal", screen: "Tela", overlay: "Sobrepor", "soft-light": "Luz suave", multiply: "Multiplicação", "linear-dodge": "Subexposição linear (Adicionar)" };

type TrackItemLike = {
  getStartTime(): Promise<TickTime>;
  createSetEndAction(t: TickTime): Action;
  getComponentChain(): Promise<{ getComponentCount(): number; getComponentAtIndex(i: number): { getMatchName(): Promise<string>; getParamCount(): number; getParam(i: number): ComponentParam } }>;
};

async function readNumber(p: ComponentParam): Promise<number | null> {
  try {
    const k = (await p.getStartValue()) as unknown as { value?: unknown };
    const v = k && typeof k === "object" && "value" in k ? (k.value as { value?: unknown } | number) : k;
    const n = typeof v === "object" && v !== null && "value" in v ? Number(v.value) : Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Limite de cópias ao repetir um efeito (evita encher a timeline por engano). */
const MAX_COPIES = 200;

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

  /**
   * Executa ações como UMA etapa de Desfazer. O Premiere exige que as ações sejam
   * CRIADAS dentro do lockedAccess ("Requires locked access"), por isso recebe uma fábrica.
   */
  private transaction(project: Project, build: () => Action[], undo: string): void {
    let ok = false;
    project.lockedAccess(() => {
      const actions = build();
      if (!actions.length) {
        ok = true;
        return;
      }
      ok = project.executeTransaction((compound) => {
        for (const a of actions) compound.addAction(a);
      }, undo);
    });
    if (!ok) throw new ApplyError("host_api_error", `O Premiere recusou a operação "${undo}".`);
  }

  private motion: MotionApplier | null = null;

  async applyMotion(job: MotionJob): Promise<MotionResult> {
    const { project, sequence } = await this.require();
    const settings = await sequence.getSettings();
    const rect = await settings.getVideoFrameRect();
    const fps = settings.getVideoFrameRate().value;
    this.motion ??= new MotionApplier(this.p);
    try {
      return await this.motion.apply(project, sequence, job, { width: rect.width, height: rect.height, fps });
    } catch (e) {
      throw mapHostError(e);
    }
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
      const actions: Array<{ name: string; make: () => Action }> = [];
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
            const end = start.add(this.p.TickTime.createWithSeconds(Number(pv.value)));
            actions.push({ name: pv.name, make: () => video.createSetEndAction(end) });
            continue;
          }
          const prm = byName.get(normalizeName(pv.name));
          if (!prm) {
            warnings.push(`Parâmetro "${pv.name}" não existe neste template.`);
            continue;
          }
          const value = this.toHostValue(pv);
          actions.push({ name: pv.name, make: () => prm.createSetValueAction(prm.createKeyframe(value as never), true) });
        }
      }
      if (actions.length) {
        try {
          this.transaction(project, () => actions.flatMap(({ name, make }) => {
            try {
              return [make()];
            } catch (e) {
              warnings.push(`Não foi possível definir "${name}": ${(e as Error).message}`);
              return [];
            }
          }), `Motion Hub: parâmetros de ${label}`);
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
    const place = (at: TickTime) =>
      opts.mode === "insert"
        ? editor.createInsertProjectItemAction(item, at, opts.videoTrack, opts.audioTrack, false)
        : editor.createOverwriteItemAction(item, at, opts.videoTrack, opts.audioTrack);

    // Duração maior que o arquivo: cópias lado a lado + corte da última no tempo exato.
    const plan = (opts.fill === undefined ? null : await this.fillPlan(sequence, item, time, opts.fill)) ?? { starts: [time], trimTo: null };
    let undoSteps = 0;
    try {
      // Uma faixa nova só existe depois da primeira inserção; as demais cópias vão para ela.
      const newTrack = opts.videoTrack >= (await sequence.getVideoTrackCount());
      const first = newTrack ? 1 : plan.starts.length;
      this.transaction(project, () => plan.starts.slice(0, first).map(place), `Motion Hub: inserir ${label}`);
      undoSteps++;
      if (first < plan.starts.length) {
        this.transaction(project, () => plan.starts.slice(first).map(place), `Motion Hub: repetir ${label}`);
        undoSteps++;
      }
    } catch (e) {
      throw mapHostError(e);
    }

    // Ajustes nos clipes recém-inseridos (uma etapa de Desfazer): corte final, mesclagem, opacidade.
    const warnings: string[] = [];
    const needsLook = (opts.blend && opts.blend !== "normal") || (opts.opacity !== undefined && opts.opacity < 100);
    if (!plan.trimTo && !needsLook) return { trackItems: plan.starts.length, warnings, undoSteps };

    const placed = [];
    for (const start of plan.starts) {
      const ti = await this.trackItemAt(sequence, opts.videoTrack, start);
      if (ti) placed.push(ti);
    }
    if (placed.length < plan.starts.length) warnings.push("Não localizei todos os clipes inseridos; confira a mesclagem e o fim na timeline.");

    const makers: Array<() => Action> = [];
    const last = placed.find((ti) => ti.start.seconds === plan.starts[plan.starts.length - 1]!.seconds);
    if (plan.trimTo) {
      if (last) makers.push(() => last.item.createSetEndAction(plan.trimTo!));
      else warnings.push("Não achei a última cópia para cortar no tempo exato; ajuste o fim manualmente.");
    }
    if (needsLook) {
      for (const ti of placed) makers.push(...(await this.lookActions(project, ti.item, opts, warnings)));
    }
    if (makers.length) {
      try {
        this.transaction(project, () => makers.map((m) => m()), `Motion Hub: ajustar ${label}`);
        undoSteps++;
      } catch (e) {
        warnings.push(`Não foi possível ajustar o clipe: ${(e as Error).message}`);
      }
    }
    return { trackItems: plan.starts.length, warnings: [...new Set(warnings)], undoSteps };
  }

  /**
   * Ações de mesclagem/opacidade no efeito "Opacidade" do clipe. O valor do modo é o índice
   * na lista alfabética do Premiere; antes de usar, confere se o clipe novo está em Normal (18).
   * Se não estiver, a tabela não vale para esta versão e o modo não é alterado.
   */
  private async lookActions(project: Project, ti: TrackItemLike, opts: InsertOptions, warnings: string[]): Promise<Array<() => Action>> {
    const chain = await ti.getComponentChain();
    const comps: Array<{ getMatchName(): Promise<string>; getParamCount(): number; getParam(i: number): ComponentParam }> = [];
    project.lockedAccess(() => {
      for (let c = 0; c < chain.getComponentCount(); c++) comps.push(chain.getComponentAtIndex(c));
    });
    let comp = null;
    for (const c of comps) if ((await c.getMatchName()) === OPACITY_MATCH) comp = c;
    if (!comp) {
      warnings.push("Efeito Opacidade não encontrado; aplique o modo de mesclagem manualmente.");
      return [];
    }
    const params: ComponentParam[] = [];
    project.lockedAccess(() => {
      for (let i = 0; i < comp.getParamCount(); i++) params.push(comp.getParam(i));
    });
    const byName = (names: string[], fallback: number) => params.find((p) => names.includes(normalizeName(p.displayName))) ?? params[fallback];
    const out: Array<() => Action> = [];

    if (opts.opacity !== undefined && opts.opacity < 100) {
      const op = byName(["opacity", "opacidade", "opacite", "opacidad", "deckkraft"], 0);
      if (op) out.push(() => op.createSetValueAction(op.createKeyframe(opts.opacity!), true));
    }
    if (opts.blend && opts.blend !== "normal") {
      const bm = byName(["blendmode", "mododemesclagem", "modedefusion", "mododefusion", "fullmethode"], 1);
      const current = bm ? await readNumber(bm) : null;
      if (!bm || current !== PREMIERE_BLEND.normal) {
        warnings.push(`Aplique o modo de mesclagem "${BLEND_LABEL[opts.blend]}" em Controles de efeito → Opacidade (não consegui aplicar automaticamente nesta versão do Premiere).`);
      } else {
        const value = PREMIERE_BLEND[opts.blend];
        out.push(() => bm.createSetValueAction(bm.createKeyframe(value), true));
      }
    }
    return out;
  }

  /** Inícios das cópias e o ponto de corte, ou null se a duração original já basta. */
  private async fillPlan(sequence: Sequence, item: ProjectItem, time: TickTime, fill: number | "end"): Promise<{ starts: TickTime[]; trimTo: TickTime | null } | null> {
    const clip = this.p.ClipProjectItem.cast(item);
    const video = this.p.Constants.MediaType.VIDEO;
    const len = (await clip.getOutPoint(video)).subtract(await clip.getInPoint(video));
    if (!(len.seconds > 0)) return null;
    const target = fill === "end" ? (await sequence.getEndTime()).subtract(time) : this.p.TickTime.createWithSeconds(fill);
    if (target.seconds <= len.seconds + 1e-3) return null;
    const count = Math.min(Math.ceil(target.seconds / len.seconds - 1e-6), MAX_COPIES);
    const starts = [time];
    for (let i = 1; i < count; i++) starts.push(starts[i - 1]!.add(len));
    const end = time.add(target);
    const covered = starts[count - 1]!.add(len);
    return { starts, trimTo: covered.seconds - end.seconds > 1e-3 ? end : null };
  }

  private async trackItemAt(sequence: Sequence, track: number, start: TickTime): Promise<{ item: TrackItemLike; start: TickTime } | null> {
    const t = await sequence.getVideoTrack(track);
    // A tipagem diz síncrono, mas os exemplos da Adobe usam await: funciona nos dois casos.
    const items = (await t.getTrackItems(this.p.Constants.TrackItemType.CLIP, false)) as unknown as TrackItemLike[];
    for (const it of items) {
      if (Math.abs((await it.getStartTime()).seconds - start.seconds) < 1e-3) return { item: it, start };
    }
    return null;
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
      this.transaction(project, () => [root.createBinAction(BIN_NAME, false)], "Motion Hub: criar pasta");
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
  // "Requires locked access" é erro de API, não faixa bloqueada.
  if (!/locked access/i.test(msg) && /track.*lock|lock.*track|bloquead/i.test(msg)) return new ApplyError("track_locked", msg);
  return new ApplyError("host_api_error", msg);
}
