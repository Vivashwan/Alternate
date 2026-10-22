import { Contact } from "./types";

/**
 * Search index for fast contact searching on large lists.
 *
 * Every searchable field is normalised (lower-case, letters/digits only) and split
 * into bigrams ("asha" -> "as", "sh", "ha"), and each bigram maps to the contacts
 * containing it. A query term is answered by intersecting the posting lists of the
 * term's own bigrams, then confirming each candidate really contains the term.
 * That touches only the few small lists the query needs, instead of scanning every
 * key in the index on every keystroke.
 */
export class ContactSearchIndex {
  /** bigram -> ids of contacts with a field containing it */
  private bigrams: Map<string, Set<string>> = new Map();
  /** id -> normalised searchable fields, used to confirm candidates */
  private fields: Map<string, string[]> = new Map();
  /** id -> contact, in the order the contacts were given (keeps results sorted) */
  private contacts: Map<string, Contact> = new Map();

  constructor(contacts: Contact[]) {
    this.buildIndex(contacts);
  }

  private static normalise(text: string): string {
    return text.toLowerCase().replace(/[^\w\d]/g, "");
  }

  private buildIndex(contacts: Contact[]): void {
    this.bigrams.clear();
    this.fields.clear();
    this.contacts.clear();

    for (const contact of contacts) {
      const contactId = contact.fullPhoneNumber;
      const fields = this.extractSearchTerms(contact)
        .map(ContactSearchIndex.normalise)
        .filter((field) => field.length > 0);

      this.contacts.set(contactId, contact);
      this.fields.set(contactId, fields);

      for (const field of fields) {
        for (let i = 0; i < field.length - 1; i++) {
          const bigram = field.slice(i, i + 2);
          let ids = this.bigrams.get(bigram);
          if (!ids) {
            ids = new Set();
            this.bigrams.set(bigram, ids);
          }
          ids.add(contactId);
        }
      }
    }
  }

  private extractSearchTerms(contact: Contact): string[] {
    const terms: string[] = [];

    // Name components
    if (contact.prefix) terms.push(contact.prefix);
    terms.push(contact.name);
    if (contact.suffix) terms.push(contact.suffix);

    // Other fields
    if (contact.email) terms.push(contact.email);
    if (contact.nickname) terms.push(contact.nickname);
    if (contact.location) terms.push(contact.location);
    if (contact.appointment) terms.push(contact.appointment);

    // Phone numbers
    terms.push(contact.phoneNumber);
    terms.push(`+${contact.fullPhoneNumber}`);

    return terms.filter((term) => term.length > 0);
  }

  /** Candidate ids for one query term, from the bigram posting lists. */
  private candidatesFor(term: string): Iterable<string> {
    // A single character has no bigram; fall back to checking every contact
    if (term.length < 2) return this.contacts.keys();

    const postingLists: Set<string>[] = [];
    for (let i = 0; i < term.length - 1; i++) {
      const ids = this.bigrams.get(term.slice(i, i + 2));
      if (!ids) return []; // some bigram never occurs, so nothing can match
      postingLists.push(ids);
    }

    // Walk the smallest list and probe the others
    postingLists.sort((a, b) => a.size - b.size);
    const [smallest, ...rest] = postingLists;
    return [...smallest].filter((id) => rest.every((ids) => ids.has(id)));
  }

  private matches(contactId: string, term: string): boolean {
    return this.fields.get(contactId)!.some((field) => field.includes(term));
  }

  search(query: string, limit: number = 100): Contact[] {
    const queryTerms = query
      .toLowerCase()
      .replace(/[^\w\d\s]/g, "")
      .split(/\s+/)
      .filter((term) => term.length > 0);

    if (queryTerms.length === 0) return [];

    // Drive the search from the most selective (longest) term
    const [first, ...others] = [...queryTerms].sort((a, b) => b.length - a.length);

    // Single-character queries can't use the index; scan in order and stop at the limit
    if (first.length < 2) {
      const results: Contact[] = [];
      for (const [id, contact] of this.contacts) {
        if (results.length >= limit) break;
        if (queryTerms.every((term) => this.matches(id, term))) results.push(contact);
      }
      return results;
    }

    const matchedIds = new Set<string>();
    for (const id of this.candidatesFor(first)) {
      if (this.matches(id, first) && others.every((term) => this.matches(id, term))) {
        matchedIds.add(id);
      }
    }

    // Return in the original contact order, applying the limit
    const results: Contact[] = [];
    for (const [id, contact] of this.contacts) {
      if (results.length >= limit) break;
      if (matchedIds.has(id)) results.push(contact);
    }
    return results;
  }

  /**
   * Update the index with new contacts
   */
  updateIndex(contacts: Contact[]): void {
    this.buildIndex(contacts);
  }

  /**
   * Get index statistics for debugging
   */
  getStats(): { indexSize: number; contactCount: number; averageTermsPerContact: number } {
    return {
      indexSize: this.bigrams.size,
      contactCount: this.contacts.size,
      averageTermsPerContact: this.bigrams.size / Math.max(this.contacts.size, 1),
    };
  }
}
