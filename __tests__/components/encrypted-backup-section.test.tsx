import { EncryptedBackupSection } from "@/components/encrypted-backup-section";
import { backupApi } from "@/store/backup/backupApi";
import { makeStore } from "@/store/backup/store";
import useContactStore from "@/store/contactStore";
import { makeContact } from "@/test-utils/contacts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { PaperProvider } from "react-native-paper";
import { Provider } from "react-redux";

const contacts = [makeContact({ name: "Asha Rao" }), makeContact({ name: "Ravi Kumar", fullPhoneNumber: "14155550123" })];

/** Minimal in-memory backup server, enough for the UI flow. */
function fakeServer() {
  let stored: { envelope: unknown; contactCount: number; updatedAt: string } | null = null;
  jest.spyOn(global, "fetch").mockImplementation(async (input) => {
    const req = input as Request;
    const route = `${req.method} ${new URL(req.url).pathname}`;
    const json = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    switch (route) {
      case "POST /auth/login":
        return json(200, { accessToken: "access", refreshToken: "refresh", expiresIn: 900 });
      case "GET /backups/latest/meta":
        return stored ? json(200, { contactCount: stored.contactCount, sizeBytes: 1, updatedAt: stored.updatedAt }) : json(404, {});
      case "PUT /backups/latest": {
        const body = await req.json();
        stored = { ...body, updatedAt: "2026-10-10T10:00:00.000Z" };
        return json(200, { contactCount: body.contactCount, sizeBytes: 1, updatedAt: stored!.updatedAt });
      }
      case "GET /backups/latest":
        return json(200, { ...stored, sizeBytes: 1 });
      default:
        return json(404, {});
    }
  });
  return { get stored() { return stored; } };
}

function renderSection() {
  const store = makeStore();
  const onMessage = jest.fn();
  render(
    <Provider store={store}>
      <PaperProvider>
        <EncryptedBackupSection onMessage={onMessage} />
      </PaperProvider>
    </Provider>,
  );
  return { store, onMessage };
}

beforeEach(() => {
  jest.restoreAllMocks();
  (SecureStore as unknown as { __reset: () => void }).__reset();
  useContactStore.setState({ contacts });
});

async function signIn() {
  fireEvent.changeText(screen.getByLabelText("Server URL"), "https://backup.test/");
  fireEvent.changeText(screen.getByLabelText("Email"), "asha@example.com");
  fireEvent.changeText(screen.getByLabelText("Account password"), "long-enough-pw");
  fireEvent.press(screen.getByText("Sign in"));
  await screen.findByText("Signed in as asha@example.com");
}

it("keeps sign-in disabled until the form is valid", () => {
  renderSection();

  expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();

  fireEvent.changeText(screen.getByLabelText("Server URL"), "https://backup.test");
  fireEvent.changeText(screen.getByLabelText("Email"), "asha@example.com");
  fireEvent.changeText(screen.getByLabelText("Account password"), "short");
  expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();

  fireEvent.changeText(screen.getByLabelText("Account password"), "long-enough-pw");
  expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

it("signs in, encrypts and uploads the contacts, then shows the backup", async () => {
  const server = fakeServer();
  const { onMessage, store } = renderSection();

  await signIn();
  expect(await screen.findByText("No backup yet")).toBeTruthy();
  expect(store.getState().auth.serverUrl).toBe("https://backup.test"); // trailing slash trimmed

  fireEvent.changeText(screen.getByLabelText("Backup passphrase"), "orange-kettle-violin");
  fireEvent.press(screen.getByText("Back up now"));

  await waitFor(() => expect(onMessage).toHaveBeenCalledWith("Backup complete", "2 contacts were encrypted and uploaded."));
  // The server received ciphertext only
  expect(JSON.stringify(server.stored)).not.toContain("Asha");
  expect(await screen.findByText(/Last backup: .* · 2 contacts/)).toBeTruthy();

  store.dispatch(backupApi.util.resetApiState());
}, 20_000);

it("explains a wrong passphrase on restore", async () => {
  fakeServer();
  const { onMessage, store } = renderSection();
  await signIn();

  fireEvent.changeText(screen.getByLabelText("Backup passphrase"), "orange-kettle-violin");
  fireEvent.press(screen.getByText("Back up now"));
  await waitFor(() => expect(onMessage).toHaveBeenCalledWith("Backup complete", expect.any(String)));

  fireEvent.changeText(screen.getByLabelText("Backup passphrase"), "wrong-passphrase");
  await waitFor(() => expect(screen.getByRole("button", { name: "Restore" })).toBeEnabled());
  fireEvent.press(screen.getByText("Restore"));

  await waitFor(() =>
    expect(onMessage).toHaveBeenCalledWith("Restore failed", "That passphrase doesn't match this backup."),
  );

  store.dispatch(backupApi.util.resetApiState());
}, 20_000);
