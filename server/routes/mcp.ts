import { defineHandler } from "nitro";
import { handleMcpRequest } from "../../src/lib/grokMcp.js";

export default defineHandler((event) => handleMcpRequest(event.req));
