/** Contrato entre o painel e o aplicativo Adobe (adaptador por host, §2). */
import type { HostName, ParameterType } from "@motionhub/shared";

export interface SequenceInfo {
  name: string;
  fps: number;
  width: number;
  height: number;
  playheadSec: number;
  durationSec: number;
  videoTracks: number;
  audioTracks: number;
}

export interface HostContext {
  host: HostName;
  hostVersion: string;
  project: { name: string } | null;
  sequence: SequenceInfo | null;
}

export interface InsertOptions {
  /** "playhead", "start" ou segundos absolutos. */
  at: "playhead" | "start" | number;
  /** Índice zero-based. Índice ≥ número de faixas cria nova faixa (comportamento da API). */
  videoTrack: number;
  audioTrack: number;
  mode: "overwrite" | "insert";
  /**
   * Só para mídia: repete o arquivo em sequência até cobrir esta duração (segundos)
   * ou até o fim da sequência ("end"). Ausente = duração original do arquivo.
   */
  fill?: number | "end";
}

export interface HostParamValue {
  /** Nome do controle no host. */
  name: string;
  type: ParameterType;
  value: unknown;
}

export interface InsertResult {
  trackItems: number;
  /** Parâmetros não encontrados no template, por exemplo. */
  warnings: string[];
  /** Quantas vezes o editor precisa apertar Ctrl+Z para desfazer tudo (padrão 1). */
  undoSteps?: number;
}

export interface HostAdapter {
  getContext(): Promise<HostContext>;
  insertMogrt(path: string, opts: InsertOptions, params: HostParamValue[], label: string): Promise<InsertResult>;
  insertMedia(path: string, opts: InsertOptions, label: string): Promise<InsertResult>;
}
