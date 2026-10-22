import useDebounce from "@/hooks/useDebounce";
import { ContactSearchIndex } from "@/lib/search-index";
import { preprocessContactsForSearch, searchContacts } from "@/lib/search-utils";
import { Contact } from "@/lib/types";
import { useMemo } from "react";

/** Above this many contacts, the bigram index beats a linear scan. */
export const SEARCH_INDEX_THRESHOLD = 1000;
const INDEX_RESULT_LIMIT = 50;

/**
 * Debounced contact search that picks the faster strategy for the list size:
 * a linear scan for small lists, the bigram ContactSearchIndex for large ones.
 */
export function useAdvancedContactSearch(
  contacts: Contact[],
  query: string,
  delay: number = 300
) {
  const useSearchIndex = contacts.length > SEARCH_INDEX_THRESHOLD;
  const [debouncedQuery, isSearching] = useDebounce(query, delay);

  // Rebuilt only when the contact list changes, never per keystroke. Derived with
  // useMemo (not built inside an effect) so results can never use a stale index.
  const searchIndex = useMemo(
    () => (useSearchIndex ? new ContactSearchIndex(contacts) : null),
    [contacts, useSearchIndex]
  );
  const searchableContacts = useMemo(
    () => (useSearchIndex ? [] : preprocessContactsForSearch(contacts)),
    [contacts, useSearchIndex]
  );

  const searchResults = useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    return searchIndex
      ? searchIndex.search(debouncedQuery, INDEX_RESULT_LIMIT)
      : searchContacts(searchableContacts, debouncedQuery);
  }, [debouncedQuery, searchIndex, searchableContacts]);

  return {
    searchResults,
    isSearching,
    searchStrategy: useSearchIndex ? ("index" as const) : ("linear" as const),
    contactCount: contacts.length,
  };
}
