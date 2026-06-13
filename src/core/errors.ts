export class PresenceError extends Error {
  code: string;
  status?: number;

  constructor(message: string, options: { code: string; status?: number }) {
    super(message);
    this.name = "PresenceError";
    this.code = options.code;

    if (options.status !== undefined) {
      this.status = options.status;
    }
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}
