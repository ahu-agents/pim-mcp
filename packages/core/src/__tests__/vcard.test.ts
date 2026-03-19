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

  it("parses ADR lines into PostalAddress objects", () => {
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nUID:a1\nFN:Addr Test\nADR;TYPE=home:;;123 Main St;Denver;CO;80202;US\nADR;TYPE=work:PO Box 100;Suite 2;456 Oak Ave;Austin;TX;73301;US\nEND:VCARD`;
    const contact = parseVCard(vcard);
    expect(contact.addresses).toEqual([
      {
        type: "home",
        street: "123 Main St",
        city: "Denver",
        state: "CO",
        postalCode: "80202",
        country: "US",
      },
      {
        type: "work",
        street: "PO Box 100, Suite 2, 456 Oak Ave",
        city: "Austin",
        state: "TX",
        postalCode: "73301",
        country: "US",
      },
    ]);
  });

  it("handles ADR with empty components", () => {
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nUID:a2\nFN:Minimal Addr\nADR:;;;;;;US\nEND:VCARD`;
    const contact = parseVCard(vcard);
    expect(contact.addresses).toEqual([{ country: "US" }]);
  });

  it("handles vCard 4.0", () => {
    const v4 = `BEGIN:VCARD\nVERSION:4.0\nUID:v4-1\nFN:V4 Person\nEMAIL:v4@test.com\nEND:VCARD`;
    const contact = parseVCard(v4);
    expect(contact.uid).toBe("v4-1");
    expect(contact.fullName).toBe("V4 Person");
    expect(contact.emails).toEqual([{ value: "v4@test.com" }]);
  });

  it("extracts ORG first component only, stripping trailing semicolons", () => {
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nUID:o1\nFN:Org Test\nORG:Acme Corp;Engineering;Platform\nEND:VCARD`;
    const contact = parseVCard(vcard);
    expect(contact.organization).toBe("Acme Corp");
  });

  it("parses ROLE, NICKNAME, BDAY, and CATEGORIES", () => {
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nUID:f1\nFN:Fields Test\nROLE:Project Lead\nNICKNAME:Johnny\nBDAY:1990-01-01\nCATEGORIES:Friends,Family,VIP\nEND:VCARD`;
    const contact = parseVCard(vcard);
    expect(contact.role).toBe("Project Lead");
    expect(contact.nickname).toBe("Johnny");
    expect(contact.birthday).toBe("1990-01-01");
    expect(contact.categories).toEqual(["Friends", "Family", "VIP"]);
  });

  it("extracts BDAY as-is without normalizing format", () => {
    const compact = `BEGIN:VCARD\nVERSION:3.0\nUID:b1\nFN:Compact\nBDAY:19900101\nEND:VCARD`;
    expect(parseVCard(compact).birthday).toBe("19900101");
    const partial = `BEGIN:VCARD\nVERSION:3.0\nUID:b2\nFN:Partial\nBDAY:--01-01\nEND:VCARD`;
    expect(parseVCard(partial).birthday).toBe("--01-01");
  });

  it("captures unknown properties in otherProperties", () => {
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nUID:r1\nFN:Raw Test\nPHOTO;VALUE=uri:https://example.com/photo.jpg\nX-SOCIALPROFILE;TYPE=twitter:@test\nEND:VCARD`;
    const contact = parseVCard(vcard);
    expect(contact.otherProperties).toEqual([
      "PHOTO;VALUE=uri:https://example.com/photo.jpg",
      "X-SOCIALPROFILE;TYPE=twitter:@test",
    ]);
  });

  it("round-trips otherProperties through build and parse", () => {
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nUID:rt1\nFN:Roundtrip\nPHOTO;VALUE=uri:https://example.com/photo.jpg\nX-CUSTOM:hello\nEND:VCARD`;
    const contact = parseVCard(vcard);
    const rebuilt = buildVCard(contact);
    const reparsed = parseVCard(rebuilt);
    expect(reparsed.otherProperties).toEqual(contact.otherProperties);
    expect(reparsed.uid).toBe("rt1");
    expect(reparsed.fullName).toBe("Roundtrip");
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

  it("builds ADR lines from PostalAddress objects", () => {
    const contact: Contact = {
      uid: "ab1",
      fullName: "Addr Build",
      emails: [],
      phones: [],
      addresses: [
        {
          type: "home",
          street: "123 Main St",
          city: "Denver",
          state: "CO",
          postalCode: "80202",
          country: "US",
        },
      ],
      urls: [],
      otherProperties: [],
    };
    const vcard = buildVCard(contact);
    expect(vcard).toContain("ADR;TYPE=home:;;123 Main St;Denver;CO;80202;US");
  });

  it("builds ROLE, NICKNAME, BDAY, and CATEGORIES lines", () => {
    const contact: Contact = {
      uid: "sf1",
      fullName: "Simple Fields",
      emails: [],
      phones: [],
      addresses: [],
      urls: [],
      role: "Project Lead",
      nickname: "Johnny",
      birthday: "1990-01-01",
      categories: ["Friends", "Family"],
      otherProperties: [],
    };
    const vcard = buildVCard(contact);
    expect(vcard).toContain("ROLE:Project Lead");
    expect(vcard).toContain("NICKNAME:Johnny");
    expect(vcard).toContain("BDAY:1990-01-01");
    expect(vcard).toContain("CATEGORIES:Friends,Family");
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
