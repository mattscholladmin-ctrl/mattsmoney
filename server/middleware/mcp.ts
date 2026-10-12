// Serves https://mattsmoney.vercel.app/mcp before the page handler.
// The page handler rejects anything that is not a browser page.
import { handleMcpRequest } from "../../src/lib/grokMcp.js";

interface McpEvent {
  url: URL;
  req: Request;
}

export default async function mcpDoor(
  event: McpEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const path = event.url?.pathname?.replace(/\/+$/, "") || "";
  if (path !== "/mcp") return next();
  return handleMcpRequest(new Request(event.url, event.req));
}
