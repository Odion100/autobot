import { readFile } from "fs/promises";

// Starter module for the SystemView hub connection. Grow this surface as we
// expose real autobot internals (jobs, selector memory, driver state) for testing.
export default {
  async ping() {
    return { ok: true, service: "Autobot", ts: Date.now() };
  },
  async echo(message) {
    return { message };
  },
  async info() {
    const pkg = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8")
    );
    return {
      name: pkg.name,
      version: pkg.version,
      description:
        "AI web automation assistant — Puppeteer browser driven by natural language",
      node: process.version,
    };
  },
};
