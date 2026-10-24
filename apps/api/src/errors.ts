export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, "bad_request", msg, details);
export const unauthorized = (msg = "Autenticação necessária.") => new HttpError(401, "unauthorized", msg);
export const forbidden = (msg = "Sem permissão para esta ação.") => new HttpError(403, "forbidden", msg);
export const notFound = (what = "Recurso") => new HttpError(404, "not_found", `${what} não encontrado.`);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, "conflict", msg, details);
export const unprocessable = (msg: string, details?: unknown) => new HttpError(422, "unprocessable", msg, details);
