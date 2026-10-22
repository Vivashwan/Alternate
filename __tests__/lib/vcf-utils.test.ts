import { contactsToVCF, contactToVCF, parseVCF } from "@/lib/vcf-utils";
import type { Contact } from "@/lib/types";

const baseContact: Contact = {
  name: "Asha Rao",
  fullPhoneNumber: "919876543210",
  phoneNumber: "9876543210",
  countryCode: "IN",
  appointment: "",
  location: "",
  iosRow: "",
  suffix: "",
  prefix: "",
  email: "",
  notes: "",
  website: "",
  labels: "",
  birthday: "",
  nickname: "",
  photo: "",
};

const contact = (overrides: Partial<Contact> = {}): Contact => ({ ...baseContact, ...overrides });

describe("contactToVCF", () => {
  it("writes a minimal vCard with name and phone number", () => {
    const vcf = contactToVCF(contact());

    expect(vcf.split("\r\n")).toEqual([
      "BEGIN:VCARD",
      "VERSION:2.1",
      "N:;Asha Rao;;;",
      "FN:Asha Rao",
      "TEL;CELL;PREF:+919876543210",
      "END:VCARD",
    ]);
  });

  it("only writes optional fields that are set", () => {
    const vcf = contactToVCF(contact({ email: "asha@example.com", appointment: "Dentist" }));

    expect(vcf).toContain("EMAIL;PREF;HOME:asha@example.com");
    expect(vcf).toContain("TITLE:Dentist");
    expect(vcf).not.toContain("NOTE");
    expect(vcf).not.toContain("BDAY");
  });

  it("escapes vCard special characters in values", () => {
    const vcf = contactToVCF(contact({ notes: "line1\nline2; a, b \\ c" }));

    expect(vcf).toContain("NOTE:line1\\nline2\\; a\\, b \\\\ c");
  });

  it("escapes special characters in the structured name field", () => {
    const vcf = contactToVCF(contact({ name: "Rao; Asha" }));

    expect(vcf).toContain("N:;Rao\\; Asha;;;");
  });

  it("separates multiple contacts with a blank line", () => {
    const vcf = contactsToVCF([contact(), contact({ name: "Ben", fullPhoneNumber: "14155550123" })]);

    expect(vcf.match(/BEGIN:VCARD/g)).toHaveLength(2);
    expect(vcf).toContain("END:VCARD\r\n\r\nBEGIN:VCARD");
  });
});

describe("parseVCF", () => {
  it("round-trips every field written by contactToVCF", () => {
    const original = contact({
      prefix: "Dr.",
      suffix: "Jr.",
      nickname: "Ash",
      email: "asha@example.com",
      location: "Bengaluru",
      appointment: "Dentist",
      website: "https://example.com",
      notes: "Prefers mornings",
      birthday: "1990-04-12",
      photo: "data:image/jpeg;base64,AAAA",
    });

    const [parsed] = parseVCF(contactToVCF(original));

    expect(parsed).toEqual(original);
  });

  it("round-trips values containing ; , newlines and backslashes", () => {
    const original = contact({
      name: "Rao; Asha, PhD",
      nickname: "A;B",
      location: "Flat 2; MG Road, Bengaluru",
      notes: "line1\nline2; a, b \\ c",
    });

    const [parsed] = parseVCF(contactToVCF(original));

    expect(parsed.name).toBe(original.name);
    expect(parsed.nickname).toBe(original.nickname);
    expect(parsed.location).toBe(original.location);
    expect(parsed.notes).toBe(original.notes);
  });

  it("parses several contacts and skips entries without a name or number", () => {
    const vcf = [
      contactToVCF(contact()),
      "BEGIN:VCARD\r\nVERSION:2.1\r\nFN:No Number\r\nEND:VCARD",
      contactToVCF(contact({ name: "Ben Lee", fullPhoneNumber: "14155550123", phoneNumber: "4155550123", countryCode: "US" })),
    ].join("\r\n");

    const parsed = parseVCF(vcf);

    expect(parsed.map((c) => c.name)).toEqual(["Asha Rao", "Ben Lee"]);
    expect(parsed[1].countryCode).toBe("US");
  });

  it("reads Android exports that put parameters on the N field", () => {
    const vcf = "BEGIN:VCARD\nVERSION:2.1\nN;CHARSET=UTF-8:Rao;Asha;;;\nTEL;CELL:+919876543210\nEND:VCARD";

    const [parsed] = parseVCF(vcf);

    expect(parsed?.name).toBe("Asha Rao");
  });

  it("falls back to FN when there is no N field", () => {
    const vcf = "BEGIN:VCARD\nVERSION:3.0\nFN:Asha Rao\nTEL:+919876543210\nEND:VCARD";

    const [parsed] = parseVCF(vcf);

    expect(parsed?.name).toBe("Asha Rao");
  });

  it("matches field names case-insensitively", () => {
    const vcf = "begin:vcard\nversion:3.0\nn:Rao;Asha;;;\ntel;type=cell:+919876543210\nnote:hi\nend:vcard";

    const [parsed] = parseVCF(vcf);

    expect(parsed?.name).toBe("Asha Rao");
    expect(parsed?.notes).toBe("hi");
  });

  it("uses the first email and address even when none is marked PREF", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Rao;Asha;;;",
      "TEL:+919876543210",
      "EMAIL;TYPE=INTERNET:first@example.com",
      "EMAIL;TYPE=WORK:second@example.com",
      "ADR;TYPE=HOME:;;12 MG Road;Bengaluru;;;",
      "END:VCARD",
    ].join("\n");

    const [parsed] = parseVCF(vcf);

    expect(parsed?.email).toBe("first@example.com");
    expect(parsed?.location).toBe("Bengaluru");
  });

  it("prefers the PREF email over an earlier non-preferred one", () => {
    const vcf = [
      "BEGIN:VCARD",
      "N:Rao;Asha;;;",
      "TEL:+919876543210",
      "EMAIL;TYPE=WORK:work@example.com",
      "EMAIL;PREF;HOME:home@example.com",
      "END:VCARD",
    ].join("\n");

    expect(parseVCF(vcf)[0]?.email).toBe("home@example.com");
  });

  it("unfolds long folded lines such as photos", () => {
    const vcf = "BEGIN:VCARD\r\nN:;Asha;;;\r\nTEL:+919876543210\r\nPHOTO;ENCODING=BASE64;TYPE=PNG:AAAA\r\n BBBB\r\n CCCC\r\nEND:VCARD";

    const [parsed] = parseVCF(vcf);

    expect(parsed?.photo).toBe("data:image/png;base64,AAAABBBBCCCC");
  });

  it("keeps only valid birthday formats", () => {
    const make = (bday: string) =>
      parseVCF(`BEGIN:VCARD\nN:;Asha;;;\nTEL:+919876543210\nBDAY:${bday}\nEND:VCARD`)[0]?.birthday;

    expect(make("1990-04-12")).toBe("1990-04-12");
    expect(make("--04-12")).toBe("--04-12");
    expect(make("12/04/1990")).toBe("");
  });

  it("uses the SIM country to parse numbers without an international prefix", () => {
    const [parsed] = parseVCF("BEGIN:VCARD\nN:;Asha;;;\nTEL:098765 43210\nEND:VCARD");

    expect(parsed?.countryCode).toBe("IN");
    expect(parsed?.fullPhoneNumber).toBe("919876543210");
  });
});
