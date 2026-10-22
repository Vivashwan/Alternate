import {
  type BackupEnvelope,
  decryptContacts,
  encryptContacts,
  type KdfParams,
  WrongPassphraseError,
} from "@/lib/backup-crypto";
import { makeContact } from "@/test-utils/contacts";

// Minimum cost the backup server accepts; keeps the tests fast
const FAST_KDF: KdfParams = { N: 2 ** 14, r: 8, p: 1 };
const PASSPHRASE = "orange-kettle-violin";
const contacts = [
  makeContact({ name: "Asha Rao", notes: "Prefers mornings ☀️" }),
  makeContact({ name: "Ravi Kumar", fullPhoneNumber: "14155550123", photo: "data:image/jpeg;base64,AAAA" }),
];

const encrypt = () => encryptContacts(contacts, PASSPHRASE, FAST_KDF);

it("round-trips contacts, including unicode and photos", async () => {
  const envelope = await encrypt();

  await expect(decryptContacts(envelope, PASSPHRASE)).resolves.toEqual(contacts);
});

it("produces an envelope the backup server will accept", async () => {
  const envelope = await encrypt();

  expect(envelope).toEqual({
    version: 1,
    kdf: { name: "scrypt", N: 16384, r: 8, p: 1, salt: expect.stringMatching(/^[A-Za-z0-9+/]+=*$/) },
    cipher: "xchacha20-poly1305",
    nonce: expect.stringMatching(/^[A-Za-z0-9+/]+=*$/),
    ciphertext: expect.stringMatching(/^[A-Za-z0-9+/]+=*$/),
  });
});

it("never contains the plaintext", async () => {
  const serialised = JSON.stringify(await encrypt());

  expect(serialised).not.toContain("Asha");
  expect(serialised).not.toContain("14155550123");
});

it("uses a fresh salt and nonce every time", async () => {
  const [a, b] = await Promise.all([encrypt(), encrypt()]);

  expect(a.kdf.salt).not.toBe(b.kdf.salt);
  expect(a.nonce).not.toBe(b.nonce);
  expect(a.ciphertext).not.toBe(b.ciphertext);
});

it("rejects the wrong passphrase", async () => {
  const envelope = await encrypt();

  await expect(decryptContacts(envelope, "orange-kettle-violiN")).rejects.toBeInstanceOf(WrongPassphraseError);
});

it("detects a modified ciphertext", async () => {
  const envelope = await encrypt();
  const bytes = atob(envelope.ciphertext).split("");
  bytes[5] = String.fromCharCode(bytes[5].charCodeAt(0) ^ 1);
  const tampered: BackupEnvelope = { ...envelope, ciphertext: btoa(bytes.join("")) };

  await expect(decryptContacts(tampered, PASSPHRASE)).rejects.toBeInstanceOf(WrongPassphraseError);
});

it("detects tampering with the KDF parameters in the header", async () => {
  const envelope = await encrypt();
  // An attacker can't lower the cost and keep the backup decryptable: the header is authenticated
  const tampered: BackupEnvelope = { ...envelope, kdf: { ...envelope.kdf, p: 2 } };

  await expect(decryptContacts(tampered, PASSPHRASE)).rejects.toBeInstanceOf(WrongPassphraseError);
});

it("refuses short passphrases", async () => {
  await expect(encryptContacts(contacts, "short", FAST_KDF)).rejects.toThrow("at least 8 characters");
});

it("rejects unknown envelope versions", async () => {
  const envelope = { ...(await encrypt()), version: 2 } as unknown as BackupEnvelope;

  await expect(decryptContacts(envelope, PASSPHRASE)).rejects.toThrow("Unsupported backup format");
});
