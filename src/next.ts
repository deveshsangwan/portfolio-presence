import { getErrorMessage, PresenceError } from "./core/errors";
import type { PlayedInput, PresenceClient } from "./core/types";

export interface PresenceGetHandlerOptions {
  cacheControl?: string;
  headers?: HeadersInit;
}

export interface PlayedIngestHandlerOptions {
  headerName?: string;
  secret: string | string[];
}

export function createPresenceGetHandler(
  presence: PresenceClient,
  options: PresenceGetHandlerOptions = {}
) {
  return async function GET() {
    const snapshot = await presence.getSnapshot();
    const headers = new Headers(options.headers);
    headers.set(
      "Cache-Control",
      options.cacheControl ?? "public, max-age=0, s-maxage=60, stale-while-revalidate=300"
    );

    return json(snapshot, { headers });
  };
}

export function createPlayedIngestHandler(
  presence: PresenceClient,
  options: PlayedIngestHandlerOptions
) {
  return async function POST(request: Request) {
    const token = tokenFromRequest(request, options.headerName);

    if (!matchesSecret(token, options.secret)) {
      return json(
        {
          error: {
            code: "unauthorized",
            message: "Unauthorized."
          }
        },
        { status: 401 }
      );
    }

    try {
      const input = (await request.json()) as PlayedInput;
      const card = await presence.recordPlayed(input);

      return json(
        {
          card,
          ok: true
        },
        { status: 201 }
      );
    } catch (error) {
      const status = error instanceof PresenceError ? error.status ?? 400 : 400;
      const code = error instanceof PresenceError ? error.code : "invalid_request";

      return json(
        {
          error: {
            code,
            message: getErrorMessage(error)
          },
          ok: false
        },
        { status }
      );
    }
  };
}

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(body), {
    ...init,
    headers
  });
}

function matchesSecret(token: string | null, secret: string | string[]) {
  if (!token) {
    return false;
  }

  const secrets = Array.isArray(secret) ? secret : [secret];
  return secrets.some((candidate) => constantTimeEqual(token, candidate));
}

function tokenFromRequest(request: Request, headerName = "authorization") {
  const customHeader = request.headers.get(headerName);

  if (headerName.toLowerCase() !== "authorization" && customHeader) {
    return customHeader;
  }

  const authorization = request.headers.get("authorization");

  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}
