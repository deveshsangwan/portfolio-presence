import { createPlayedIngestHandler } from "portfolio-presence/next";
import { presence } from "../../../../lib/presence";

export const POST = createPlayedIngestHandler(presence, {
  secret: process.env.PRESENCE_INGEST_SECRET ?? "example-secret"
});
