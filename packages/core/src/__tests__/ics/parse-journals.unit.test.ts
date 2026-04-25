import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import "../../ics/_tz-init.js";
import { parseIcsJournals } from "../../ics/parse-journals.js";

describe("parseIcsJournals", () => {
  it("vjournal_basic", () => {
    const fixtures = path.join(__dirname, "fixtures");
    const ics = fs.readFileSync(path.join(fixtures, "vjournal_basic.ics"), "utf-8");
    const oracle = JSON.parse(
      fs.readFileSync(path.join(fixtures, "vjournal_basic.oracle.json"), "utf-8"),
    );
    expect(parseIcsJournals(ics)).toEqual(oracle.expected);
  });
});
