import { describe, expect, it } from "vitest";
import { type Contact, buildVCard, parseVCard } from "../vcard.js";

const SAMPLE_VCARD = `BEGIN:VCARD
VERSION:3.0
UID:abc-123
FN:John Doe
N:Doe;John;;;
EMAIL;TYPE=HOME:john@example.com
EMAIL;TYPE=WORK:john@work.com
TEL;TYPE=CELL:+1-555-0100
TEL;TYPE=HOME:+1-555-0100
ORG:ACME Inc
TITLE:Developer
NOTE:Met at conference
END:VCARD`;

describe("parseVCard", () => {
  it("parses a full vCard into a Contact object", () => {
    const contact = parseVCard(SAMPLE_VCARD);
    expect(contact.uid).toBe("abc-123");
    expect(contact.fullName).toBe("John Doe");
    expect(contact.lastName).toBe("Doe");
    expect(contact.firstName).toBe("John");
    expect(contact.emails).toEqual([
      { type: "home", value: "john@example.com" },
      { type: "work", value: "john@work.com" },
    ]);
    expect(contact.phones).toEqual([
      { type: "cell", value: "+1-555-0100" },
      { type: "home", value: "+1-555-0100" },
    ]);
    expect(contact.organization).toBe("ACME Inc");
    expect(contact.title).toBe("Developer");
    expect(contact.note).toBe("Met at conference");
  });

  it("handles minimal vCard with only UID and FN", () => {
    const minimal = `BEGIN:VCARD\nVERSION:3.0\nUID:min-1\nFN:Jane\nEND:VCARD`;
    const contact = parseVCard(minimal);
    expect(contact.uid).toBe("min-1");
    expect(contact.fullName).toBe("Jane");
    expect(contact.emails).toEqual([]);
    expect(contact.phones).toEqual([]);
  });

  it("extracts TYPE parameter from email/phone/url lines", () => {
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nUID:t1\nFN:Test\nEMAIL;TYPE=WORK:work@test.com\nEMAIL:plain@test.com\nTEL;TYPE=CELL:+1-555-0100\nTEL;TYPE=WORK;TYPE=VOICE:+1-555-0100\nURL;TYPE=home:https://example.com\nURL:https://other.com\nEND:VCARD`;
    const contact = parseVCard(vcard);
    expect(contact.emails).toEqual([
      { type: "work", value: "work@test.com" },
      { value: "plain@test.com" },
    ]);
    expect(contact.phones).toEqual([
      { type: "cell", value: "+1-555-0100" },
      { type: "work,voice", value: "+1-555-0100" },
    ]);
    expect(contact.urls).toEqual([
      { type: "home", value: "https://example.com" },
      { value: "https://other.com" },
    ]);
  });

  it("handles vCard 4.0", () => {
    const v4 = `BEGIN:VCARD\nVERSION:4.0\nUID:v4-1\nFN:V4 Person\nEMAIL:v4@test.com\nEND:VCARD`;
    const contact = parseVCard(v4);
    expect(contact.uid).toBe("v4-1");
    expect(contact.fullName).toBe("V4 Person");
    expect(contact.emails).toEqual([{ value: "v4@test.com" }]);
  });
});

describe("buildVCard", () => {
  it("builds a valid vCard 3.0 string from a Contact", () => {
    const contact: Contact = {
      uid: "new-1",
      fullName: "Jane Smith",
      firstName: "Jane",
      lastName: "Smith",
      emails: [{ value: "jane@example.com" }],
      phones: [{ value: "+1-555-0100" }],
      addresses: [],
      urls: [],
      organization: "Widgets Co",
      title: "Manager",
      note: "A note",
      otherProperties: [],
    };
    const vcard = buildVCard(contact);
    expect(vcard).toContain("BEGIN:VCARD");
    expect(vcard).toContain("VERSION:3.0");
    expect(vcard).toContain("UID:new-1");
    expect(vcard).toContain("FN:Jane Smith");
    expect(vcard).toContain("N:Smith;Jane;;;");
    expect(vcard).toContain("EMAIL:jane@example.com");
    expect(vcard).toContain("TEL:+1-555-0100");
    expect(vcard).toContain("ORG:Widgets Co");
    expect(vcard).toContain("TITLE:Manager");
    expect(vcard).toContain("NOTE:A note");
    expect(vcard).toContain("END:VCARD");
  });

  it("builds typed EMAIL/TEL/URL lines with TYPE parameter", () => {
    const contact: Contact = {
      uid: "tb1",
      fullName: "Type Build",
      emails: [{ type: "work", value: "work@test.com" }, { value: "plain@test.com" }],
      phones: [{ type: "cell", value: "+1-555-0100" }],
      addresses: [],
      urls: [{ type: "home", value: "https://example.com" }],
      otherProperties: [],
    };
    const vcard = buildVCard(contact);
    expect(vcard).toContain("EMAIL;TYPE=work:work@test.com");
    expect(vcard).toContain("EMAIL:plain@test.com");
    expect(vcard).toContain("TEL;TYPE=cell:+1-555-0100");
    expect(vcard).toContain("URL;TYPE=home:https://example.com");
  });

  it("builds vCard with only required fields", () => {
    const contact: Contact = {
      uid: "min-1",
      fullName: "Minimal",
      emails: [],
      phones: [],
      addresses: [],
      urls: [],
      otherProperties: [],
    };
    const vcard = buildVCard(contact);
    expect(vcard).toContain("FN:Minimal");
    expect(vcard).not.toContain("EMAIL");
    expect(vcard).not.toContain("TEL");
    expect(vcard).not.toContain("ORG");
  });
});
