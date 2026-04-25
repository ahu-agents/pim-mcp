import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import "../../ics/_tz-init.js";
import { parseIcsTodos } from "../../ics/parse-todos.js";

const FIXTURES = path.join(__dirname, "fixtures");

function load(name: string) {
  const ics = fs.readFileSync(path.join(FIXTURES, `${name}.ics`), "utf-8");
  const oracle = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.oracle.json`), "utf-8"));
  return { ics, oracle };
}

describe("parseIcsTodos", () => {
  it("vtodo_basic", () => {
    const { ics, oracle } = load("vtodo_basic");
    expect(parseIcsTodos(ics)).toEqual(oracle.expected);
  });
  it("vtodo_with_due_completed", () => {
    const { ics, oracle } = load("vtodo_with_due_completed");
    expect(parseIcsTodos(ics)).toEqual(oracle.expected);
  });
});
