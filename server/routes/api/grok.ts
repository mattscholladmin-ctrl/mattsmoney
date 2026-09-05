import { defineHandler } from "nitro";
import { handleGrokRequest } from "../../../src/lib/grokApi.js";

export default defineHandler((event) => handleGrokRequest(event.req));
