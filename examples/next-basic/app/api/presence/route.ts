import { createPresenceGetHandler } from "portfolio-presence/next";
import { presence } from "../../../lib/presence";

export const GET = createPresenceGetHandler(presence);
