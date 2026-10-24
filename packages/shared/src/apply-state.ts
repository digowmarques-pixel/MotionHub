/**
 * Máquina de estados para aplicar um asset (Especificação §7.1).
 * idle → compatibility_checked → downloading (opcional) → validating →
 * preparing_host → inserting → verifying → completed
 */
export const APPLY_STATES = [
  "idle",
  "compatibility_checked",
  "downloading",
  "validating",
  "preparing_host",
  "inserting",
  "verifying",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ApplyState = (typeof APPLY_STATES)[number];

export const APPLY_ERRORS = [
  "unsupported",
  "permission_denied",
  "missing_dependency",
  "invalid_package",
  "host_no_project",
  "host_no_sequence",
  "track_locked",
  "cancelled",
  "host_api_error",
] as const;
export type ApplyErrorCode = (typeof APPLY_ERRORS)[number];

/** Mensagens úteis exibidas ao editor para cada falha. */
export const APPLY_ERROR_MESSAGES: Record<ApplyErrorCode, string> = {
  unsupported: "Este asset não é compatível com esta versão do aplicativo.",
  permission_denied: "Você não tem permissão para usar este asset.",
  missing_dependency: "Falta um arquivo ou dependência deste asset. Atualize o pacote no Gerenciador.",
  invalid_package: "O pacote está corrompido ou não passou na verificação de integridade.",
  host_no_project: "Abra um projeto antes de inserir.",
  host_no_sequence: "Selecione ou abra uma sequência antes de inserir.",
  track_locked: "A faixa de destino está bloqueada. Desbloqueie ou escolha outra faixa.",
  cancelled: "Operação cancelada.",
  host_api_error: "O aplicativo Adobe recusou a operação. Veja os detalhes no log.",
};

const NEXT: Record<ApplyState, readonly ApplyState[]> = {
  idle: ["compatibility_checked"],
  compatibility_checked: ["downloading", "validating"],
  downloading: ["validating"],
  validating: ["preparing_host"],
  preparing_host: ["inserting"],
  inserting: ["verifying"],
  verifying: ["completed"],
  completed: [],
  failed: [],
  cancelled: [],
};

const TERMINAL: ReadonlySet<ApplyState> = new Set(["completed", "failed", "cancelled"]);

export interface ApplyEvent {
  correlationId: string;
  state: ApplyState;
  at: number;
  error?: { code: ApplyErrorCode; detail?: string };
}

export class ApplyOperation {
  readonly correlationId: string;
  private _state: ApplyState = "idle";
  private _error: ApplyEvent["error"];
  readonly events: ApplyEvent[] = [];

  constructor(
    correlationId: string,
    private readonly onEvent?: (e: ApplyEvent) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.correlationId = correlationId;
    this.emit();
  }

  get state(): ApplyState {
    return this._state;
  }
  get error(): ApplyEvent["error"] {
    return this._error;
  }
  get done(): boolean {
    return TERMINAL.has(this._state);
  }

  advance(to: ApplyState): void {
    if (to === "failed" || to === "cancelled") throw new Error("use fail() ou cancel()");
    if (!NEXT[this._state].includes(to)) {
      throw new Error(`Transição inválida: ${this._state} → ${to}`);
    }
    this._state = to;
    this.emit();
  }

  fail(code: ApplyErrorCode, detail?: string): void {
    if (this.done) return;
    this._state = code === "cancelled" ? "cancelled" : "failed";
    this._error = { code, detail };
    this.emit();
  }

  cancel(): void {
    this.fail("cancelled");
  }

  private emit(): void {
    const e: ApplyEvent = { correlationId: this.correlationId, state: this._state, at: this.now() };
    if (this._error) e.error = this._error;
    this.events.push(e);
    this.onEvent?.(e);
  }
}

/** Erro tipado lançado pelos adaptadores de host. */
export class ApplyError extends Error {
  constructor(
    readonly code: ApplyErrorCode,
    detail?: string,
  ) {
    super(detail ?? APPLY_ERROR_MESSAGES[code]);
    this.name = "ApplyError";
  }
}
