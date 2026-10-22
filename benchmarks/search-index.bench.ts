/**
 * Benchmark for ContactSearchIndex. Not part of the normal test run:
 *   npm run bench:search
 */
import { ContactSearchIndex } from "@/lib/search-index";
import { makeContacts } from "@/test-utils/contacts";

const CONTACTS = 10_000;
const QUERIES = ["ra", "sha", "kumar", "bengaluru", "dentist", "98765", "asha rao", "zzz", "a", "mum"];
const ROUNDS = 20;

it(`searches ${CONTACTS.toLocaleString()} contacts`, () => {
  const contacts = makeContacts(CONTACTS);

  let start = performance.now();
  const index = new ContactSearchIndex(contacts);
  const buildMs = performance.now() - start;

  start = performance.now();
  for (let round = 0; round < ROUNDS; round++) {
    for (const query of QUERIES) index.search(query, 50);
  }
  const perQueryMs = (performance.now() - start) / (ROUNDS * QUERIES.length);

  console.log(
    `index build: ${buildMs.toFixed(1)} ms | avg search: ${perQueryMs.toFixed(3)} ms ` +
      `| ${index.getStats().indexSize.toLocaleString()} index keys`,
  );
});
