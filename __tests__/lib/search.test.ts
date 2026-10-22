import { ContactSearchIndex } from "@/lib/search-index";
import {
  fuzzySearchContacts,
  preprocessContactsForSearch,
  searchContacts,
} from "@/lib/search-utils";
import type { Contact } from "@/lib/types";
import { makeContact, makeContacts } from "@/test-utils/contacts";

const asha = makeContact({ name: "Asha Rao", location: "Bengaluru", appointment: "Dentist", email: "asha@example.com" });
const ravi = makeContact({
  name: "Ravi Kumar",
  fullPhoneNumber: "14155550123",
  phoneNumber: "4155550123",
  countryCode: "US",
  location: "San Francisco",
  nickname: "Rav",
});
const meera = makeContact({ name: "Meera Iyer", fullPhoneNumber: "919000000001", phoneNumber: "9000000001", prefix: "Dr." });
const all = [asha, ravi, meera];

const names = (contacts: Contact[]) => contacts.map((c) => c.name).sort();

describe("searchContacts (linear)", () => {
  const searchable = preprocessContactsForSearch(all);

  it("returns nothing for a blank query", () => {
    expect(searchContacts(searchable, "   ")).toEqual([]);
  });

  it.each([
    ["name, case-insensitive", "ASHA", ["Asha Rao"]],
    ["location", "bengal", ["Asha Rao"]],
    ["appointment", "dent", ["Asha Rao"]],
    ["nickname", "rav", ["Ravi Kumar"]],
    ["prefix", "dr.", ["Meera Iyer"]],
    ["national number", "41555", ["Ravi Kumar"]],
    ["international number", "+1415", ["Ravi Kumar"]],
  ])("matches on %s", (_label, query, expected) => {
    expect(names(searchContacts(searchable, query))).toEqual(expected);
  });

  it("requires every word of a multi-word query to match", () => {
    expect(names(searchContacts(searchable, "rao bengaluru"))).toEqual(["Asha Rao"]);
    expect(searchContacts(searchable, "rao francisco")).toEqual([]);
  });
});

describe("fuzzySearchContacts", () => {
  const searchable = preprocessContactsForSearch(all);

  it("tolerates missing letters", () => {
    expect(names(fuzzySearchContacts(searchable, "mra iyr"))).toContain("Meera Iyer");
  });

  it("ranks exact substring matches first", () => {
    const results = fuzzySearchContacts(searchable, "rao");
    expect(results[0].name).toBe("Asha Rao");
  });
});

describe("ContactSearchIndex", () => {
  it("finds contacts by partial name, field and phone number", () => {
    const index = new ContactSearchIndex(all);

    expect(names(index.search("sha"))).toEqual(["Asha Rao"]);
    expect(names(index.search("francisco"))).toEqual(["Ravi Kumar"]);
    expect(names(index.search("+1 415"))).toEqual(["Ravi Kumar"]);
    expect(names(index.search("asha@example"))).toEqual(["Asha Rao"]);
  });

  it("intersects multi-word queries", () => {
    const index = new ContactSearchIndex(all);

    expect(names(index.search("ravi san"))).toEqual(["Ravi Kumar"]);
    expect(index.search("ravi bengaluru")).toEqual([]);
  });

  it("handles single-character and blank queries", () => {
    const index = new ContactSearchIndex(all);

    expect(index.search("  ")).toEqual([]);
    expect(names(index.search("y"))).toEqual(["Meera Iyer"]);
  });

  it("respects the result limit", () => {
    const index = new ContactSearchIndex(makeContacts(500));

    expect(index.search("a", 25)).toHaveLength(25);
  });

  it("reflects updates after updateIndex", () => {
    const index = new ContactSearchIndex([asha]);
    index.updateIndex([ravi]);

    expect(index.search("asha")).toEqual([]);
    expect(names(index.search("ravi"))).toEqual(["Ravi Kumar"]);
  });

  it("returns exactly what a full scan returns, for many queries over 2,000 contacts", () => {
    const contacts = makeContacts(2_000);
    const index = new ContactSearchIndex(contacts);
    const clean = (s: string) => s.toLowerCase().replace(/[^\w\d]/g, "");

    // Reference implementation: a query term matches if any cleaned field contains it
    const fullScan = (query: string) => {
      const terms = query.toLowerCase().replace(/[^\w\d\s]/g, "").split(/\s+/).filter(Boolean);
      return contacts.filter((c) => {
        const fields = [c.prefix, c.name, c.suffix, c.email, c.nickname, c.location, c.appointment,
          c.phoneNumber, `+${c.fullPhoneNumber}`].filter(Boolean).map((f) => clean(f!));
        return terms.every((t) => fields.some((f) => f.includes(t)));
      });
    };

    for (const query of ["a", "ra", "kumar 1", "bengaluru dentist", "900", "user3", "iyer pune", "zz", "asha 19"]) {
      const expected = fullScan(query).map((c) => c.fullPhoneNumber).sort();
      const actual = index.search(query, Number.MAX_SAFE_INTEGER).map((c) => c.fullPhoneNumber).sort();
      expect({ query, results: actual }).toEqual({ query, results: expected });
    }
  });
});
