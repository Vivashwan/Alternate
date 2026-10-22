import CallerIdModule from "@/modules/caller-id";
import useContactStore from "@/store/contactStore";
import { makeContact } from "@/test-utils/contacts";
import * as vcf from "@/lib/vcf-utils";

// The native module is replaced by jest.setup.ts; expose its methods as mocks
const native = CallerIdModule as unknown as Record<
  "getAllCallerInfo" | "storeCallerInfo" | "storeMultipleCallerInfo" | "removeCallerInfo" | "removeMultipleCallerInfo",
  jest.Mock
>;

const zara = makeContact({ name: "Zara Khan", fullPhoneNumber: "911111111111", phoneNumber: "1111111111" });
const asha = makeContact({ name: "Asha Rao", fullPhoneNumber: "912222222222", phoneNumber: "2222222222" });
const meera = makeContact({ name: "Meera Iyer", fullPhoneNumber: "913333333333", phoneNumber: "3333333333" });

const state = () => useContactStore.getState();
const names = () => state().contacts.map((c) => c.name);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  useContactStore.setState({ contacts: [], isLoading: false, fetchContactError: null, addContactError: null,
    updateContactError: null, importError: null, exportError: null });
  native.storeCallerInfo.mockResolvedValue(true);
  native.storeMultipleCallerInfo.mockResolvedValue(true);
  native.removeCallerInfo.mockResolvedValue(true);
  native.removeMultipleCallerInfo.mockResolvedValue(true);
});

describe("fetchContacts", () => {
  it("loads contacts from the native module sorted by name", async () => {
    native.getAllCallerInfo.mockResolvedValue([zara, asha]);

    await state().fetchContacts();

    expect(names()).toEqual(["Asha Rao", "Zara Khan"]);
    expect(state().isLoading).toBe(false);
  });

  it("records an error and stops loading when the native call fails", async () => {
    native.getAllCallerInfo.mockRejectedValue(new Error("db locked"));

    await state().fetchContacts();

    expect(state().fetchContactError).toBe("Failed to load contacts");
    expect(state().isLoading).toBe(false);
  });
});

describe("addContact / deleteContact", () => {
  it("adds a contact in sorted position only after the native store succeeds", async () => {
    useContactStore.setState({ contacts: [zara] });

    expect(await state().addContact(asha)).toBe(true);
    expect(names()).toEqual(["Asha Rao", "Zara Khan"]);

    native.storeCallerInfo.mockResolvedValue(false);
    expect(await state().addContact(meera)).toBe(false);
    expect(names()).toEqual(["Asha Rao", "Zara Khan"]);
  });

  it("deletes one or many contacts by phone number", async () => {
    useContactStore.setState({ contacts: [asha, meera, zara] });

    await state().deleteContact(meera.fullPhoneNumber);
    expect(names()).toEqual(["Asha Rao", "Zara Khan"]);

    await state().deleteMultipleContacts([asha.fullPhoneNumber, zara.fullPhoneNumber]);
    expect(names()).toEqual([]);
  });
});

describe("updateContact", () => {
  it("removes the old record first when the phone number changes", async () => {
    useContactStore.setState({ contacts: [asha] });
    const renumbered = { ...asha, fullPhoneNumber: "919999999999", phoneNumber: "9999999999" };

    expect(await state().updateContact(asha.fullPhoneNumber, renumbered)).toBe(true);

    expect(native.removeCallerInfo).toHaveBeenCalledWith(asha.fullPhoneNumber);
    expect(state().contacts).toEqual([renumbered]);
  });

  it("keeps the original contact if removing the old number fails", async () => {
    useContactStore.setState({ contacts: [asha] });
    native.removeCallerInfo.mockResolvedValue(false);

    const ok = await state().updateContact(asha.fullPhoneNumber, { ...asha, fullPhoneNumber: "919999999999" });

    expect(ok).toBe(false);
    expect(state().updateContactError).toBe("Failed to update contact");
    expect(state().contacts).toEqual([asha]);
    expect(native.storeCallerInfo).not.toHaveBeenCalled();
  });
});

describe("importContacts", () => {
  it("stores only contacts whose numbers are not already saved", async () => {
    useContactStore.setState({ contacts: [asha] });
    jest.spyOn(vcf, "importContactsFromVCF").mockResolvedValue([asha, meera]);

    const imported = await state().importContacts();

    expect(imported).toBe(1);
    expect(native.storeMultipleCallerInfo).toHaveBeenCalledWith([meera]);
    expect(names()).toEqual(["Asha Rao", "Meera Iyer"]);
    expect(state().isImporting).toBe(false);
  });

  it("reports an empty file", async () => {
    jest.spyOn(vcf, "importContactsFromVCF").mockResolvedValue([]);

    expect(await state().importContacts()).toBe(false);
    expect(state().importError).toBe("No contacts found in the selected file");
  });
});

describe("exportContacts", () => {
  it("refuses to export an empty list", async () => {
    expect(await state().exportContacts()).toBe(false);
    expect(state().exportError).toBe("No contacts to export");
  });
});
