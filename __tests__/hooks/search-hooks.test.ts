import { SEARCH_INDEX_THRESHOLD, useAdvancedContactSearch } from "@/hooks/useAdvancedContactSearch";
import useDebounce from "@/hooks/useDebounce";
import type { Contact } from "@/lib/types";
import { makeContact, makeContacts } from "@/test-utils/contacts";
import { act, renderHook } from "@testing-library/react-native";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("useDebounce", () => {
  it("only emits the latest value once the delay passes", () => {
    const { result, rerender } = renderHook(({ value }: { value: string }) => useDebounce(value, 300), {
      initialProps: { value: "a" },
    });

    rerender({ value: "as" });
    rerender({ value: "ash" });
    expect(result.current).toEqual(["a", true]);

    act(() => jest.advanceTimersByTime(299));
    expect(result.current[0]).toBe("a");

    act(() => jest.advanceTimersByTime(1));
    expect(result.current).toEqual(["ash", false]);
  });
});

describe("useAdvancedContactSearch", () => {
  const asha = makeContact({ name: "Asha Rao" });
  const ravi = makeContact({ name: "Ravi Kumar", fullPhoneNumber: "14155550123", phoneNumber: "4155550123" });

  it("searches small lists linearly after the debounce", () => {
    const { result, rerender } = renderHook(({ q }: { q: string }) => useAdvancedContactSearch([asha, ravi], q, 300), {
      initialProps: { q: "" },
    });
    expect(result.current.searchStrategy).toBe("linear");

    rerender({ q: "ravi" });
    expect(result.current.isSearching).toBe(true);

    act(() => jest.advanceTimersByTime(300));
    expect(result.current.searchResults.map((c) => c.name)).toEqual(["Ravi Kumar"]);
    expect(result.current.isSearching).toBe(false);
  });

  it("switches to the index above the threshold and caps results", () => {
    const many = makeContacts(SEARCH_INDEX_THRESHOLD + 1);
    const { result } = renderHook(() => useAdvancedContactSearch(many, "a", 0));

    act(() => jest.runAllTimers());

    expect(result.current.searchStrategy).toBe("index");
    expect(result.current.searchResults).toHaveLength(50);
  });

  it("updates results when the contact list changes without a new query", () => {
    const { result, rerender } = renderHook(({ contacts }: { contacts: Contact[] }) => useAdvancedContactSearch(contacts, "ravi", 0), {
      initialProps: { contacts: [asha] },
    });
    act(() => jest.runAllTimers());
    expect(result.current.searchResults).toEqual([]);

    rerender({ contacts: [asha, ravi] });

    expect(result.current.searchResults.map((c) => c.name)).toEqual(["Ravi Kumar"]);
  });
});
