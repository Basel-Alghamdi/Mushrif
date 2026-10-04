export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 501 | 502,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (message = "العنصر غير موجود") => new ApiError(404, "NOT_FOUND", message);
export const forbidden = (message = "غير مصرح") => new ApiError(403, "FORBIDDEN", message);
export const invalid = (fields: Record<string, string>, message = Object.values(fields)[0] ?? "البيانات غير صحيحة") =>
  new ApiError(422, "VALIDATION_ERROR", message, fields);

export const ok = (data: unknown, meta?: unknown) => ({ data, ...(meta ? { meta } : {}) });
export const fail = (code: string, message: string, fields?: Record<string, string>, details?: unknown) =>
  ({ error: { code, message, ...(fields ? { fields } : {}), ...(details ? { details } : {}) } });
