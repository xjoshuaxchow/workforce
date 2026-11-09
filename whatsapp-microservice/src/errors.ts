export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export class RetryableError extends Error {
  override name = "RetryableError";
}
export class LeaseLostError extends Error {}
export function errorRecord(error: unknown): Record<string, unknown> {
  if (error instanceof AppError)
    return { code: error.code, message: error.message };
  // Never persist arbitrary network error messages: they can contain signed URLs or credentials.
  return {
    code: error instanceof Error ? error.name : "Error",
    message: "Operation failed; see operation type and provider details",
  };
}
