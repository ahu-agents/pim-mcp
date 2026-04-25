import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import "../../ics/_tz-init.js";
import { parseIcsEvents } from "../../ics/parse-events.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.join(__dirname, "fixtures");

interface Oracle {
  range?: { start: string; end: string };
  timezone?: string;
  expected: unknown[];
}

function loadOracles(): Array<{ name: string; ics: string; oracle: Oracle }> {
  return (
    fs
      .readdirSync(FIXTURES_DIR)
      .filter((f) => f.endsWith(".oracle.json"))
      // Only event fixtures for this runner; vtodo/vjournal handled in their own runners.
      .filter((f) => !f.startsWith("vtodo_") && !f.startsWith("vjournal_"))
      .map((oracleFile) => {
        const name = oracleFile.replace(".oracle.json", "");
        const ics = fs.readFileSync(path.join(FIXTURES_DIR, `${name}.ics`), "utf-8");
        const oracle = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, oracleFile), "utf-8"));
        return { name, ics, oracle };
      })
  );
}

describe("parseIcsEvents fixture-runner", () => {
  for (const { name, ics, oracle } of loadOracles()) {
    it(name, () => {
      const result = parseIcsEvents(ics, oracle.range, oracle.timezone);
      expect(result).toEqual(oracle.expected);
    });
  }
});
