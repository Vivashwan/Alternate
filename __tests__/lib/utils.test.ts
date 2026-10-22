import {
  getFormattedDate,
  getFormattedName,
  getFormattedPhoneNumber,
  getVisibleFields,
  trimDialCode,
} from "@/lib/utils";
import { makeContact } from "@/test-utils/contacts";

describe("trimDialCode", () => {
  it("removes an explicit international prefix", () => {
    expect(trimDialCode("+919876543210", "IN")).toBe("9876543210");
    expect(trimDialCode("00919876543210", "IN")).toBe("9876543210");
  });

  it("never trims national numbers that happen to start with the dial code digits", () => {
    // Regression: the edit screen passes national numbers; "9123456789" is a valid
    // Indian mobile and used to be shown (and re-saved) as "23456789".
    expect(trimDialCode("9123456789", "IN")).toBe("9123456789");
    expect(trimDialCode("1415555012", "US")).toBe("1415555012");
  });

  it("leaves numbers without that prefix, or with an unknown country, untouched", () => {
    expect(trimDialCode("9876543210", "IN")).toBe("9876543210");
    expect(trimDialCode("+919876543210", "XX")).toBe("+919876543210");
  });
});

describe("getFormattedPhoneNumber", () => {
  it("formats using the contact's country", () => {
    expect(getFormattedPhoneNumber(makeContact({ fullPhoneNumber: "+14155550123", countryCode: "US" }))).toBe(
      "+1 415 555 0123",
    );
  });
});

describe("getFormattedName", () => {
  it("adds prefix and suffix around the trimmed name", () => {
    expect(getFormattedName(makeContact({ name: " Asha Rao ", prefix: "Dr.", suffix: "Jr." }))).toBe(
      "Dr. Asha Rao, Jr.",
    );
  });

  it("ignores blank prefix and suffix", () => {
    expect(getFormattedName(makeContact({ name: "Asha", prefix: "  ", suffix: "" }))).toBe("Asha");
  });
});

describe("getFormattedDate", () => {
  it("formats full dates and month-day birthdays", () => {
    expect(getFormattedDate("1990-04-12")).toBe("April 12, 1990");
    expect(getFormattedDate("--04-12")).toBe("April 12");
  });
});

describe("getVisibleFields", () => {
  it("lists only optional fields that have values", () => {
    const fields = getVisibleFields(makeContact({ email: "a@b.com", notes: "hi" }));
    expect([...fields].sort()).toEqual(["email", "notes"]);
  });

  it("returns an empty set for no contact", () => {
    expect(getVisibleFields(null).size).toBe(0);
  });
});
