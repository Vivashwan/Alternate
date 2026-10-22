import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { bytesToUtf8, utf8ToBytes } from "@noble/ciphers/utils";
import { scryptAsync } from "@noble/hashes/scrypt";
import * as Crypto from "expo-crypto";
import type { Contact } from "./types";

/**
 * End-to-end encryption for cloud backups. Contacts are encrypted on the device with
 * a key derived from a passphrase the server never sees, so the backup server only
 * ever stores ciphertext.
 *
 *   key        = scrypt(passphrase, random salt)        (slow, to resist guessing)
 *   ciphertext = XChaCha20-Poly1305(key, random nonce)  (authenticated: tampering is detected)
 *
 * The envelope header (version, KDF parameters) is bound to the ciphertext as
 * associated data, so it can't be altered (e.g. to weaken the KDF) without
 * decryption failing.
 */

export type KdfParams = { N: number; r: number; p: number };

export type BackupEnvelope = {
  version: 1;
  kdf: { name: "scrypt"; salt: string } & KdfParams;
  cipher: "xchacha20-poly1305";
  nonce: string;
  ciphertext: string;
};

type BackupPayload = { format: "alternate-contacts"; exportedAt: string; contacts: Contact[] };

/** ~32 MB of memory per derivation: expensive to brute-force, still fine on a phone. */
export const DEFAULT_KDF: KdfParams = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const NONCE_LENGTH = 24;

export class WrongPassphraseError extends Error {
  constructor() {
    super("The passphrase is incorrect or the backup is damaged");
    this.name = "WrongPassphraseError";
  }
}

export async function encryptContacts(
  contacts: Contact[],
  passphrase: string,
  kdf: KdfParams = DEFAULT_KDF,
): Promise<BackupEnvelope> {
  if (passphrase.length < 8) throw new Error("Backup passphrase must be at least 8 characters");

  const salt = Crypto.getRandomBytes(SALT_LENGTH);
  const nonce = Crypto.getRandomBytes(NONCE_LENGTH);
  const header = { version: 1 as const, kdf: { name: "scrypt" as const, salt: toBase64(salt), ...kdf } };

  const key = await deriveKey(passphrase, salt, kdf);
  const payload: BackupPayload = { format: "alternate-contacts", exportedAt: new Date().toISOString(), contacts };
  const ciphertext = xchacha20poly1305(key, nonce, associatedData(header)).encrypt(
    utf8ToBytes(JSON.stringify(payload)),
  );

  return { ...header, cipher: "xchacha20-poly1305", nonce: toBase64(nonce), ciphertext: toBase64(ciphertext) };
}

export async function decryptContacts(envelope: BackupEnvelope, passphrase: string): Promise<Contact[]> {
  if (envelope.version !== 1 || envelope.cipher !== "xchacha20-poly1305" || envelope.kdf?.name !== "scrypt") {
    throw new Error("Unsupported backup format");
  }

  const { salt, N, r, p } = envelope.kdf;
  const key = await deriveKey(passphrase, fromBase64(salt), { N, r, p });
  const header = { version: envelope.version, kdf: envelope.kdf };

  let plaintext: Uint8Array;
  try {
    plaintext = xchacha20poly1305(key, fromBase64(envelope.nonce), associatedData(header)).decrypt(
      fromBase64(envelope.ciphertext),
    );
  } catch {
    // Poly1305 authentication failed: wrong key or modified data. Both look the same by design.
    throw new WrongPassphraseError();
  }

  const payload = JSON.parse(bytesToUtf8(plaintext)) as BackupPayload;
  if (payload.format !== "alternate-contacts" || !Array.isArray(payload.contacts)) {
    throw new Error("Backup does not contain contacts");
  }
  return payload.contacts;
}

function deriveKey(passphrase: string, salt: Uint8Array, { N, r, p }: KdfParams): Promise<Uint8Array> {
  // scryptAsync yields to the event loop periodically, so the UI stays responsive
  return scryptAsync(utf8ToBytes(passphrase.normalize("NFKC")), salt, { N, r, p, dkLen: KEY_LENGTH });
}

function associatedData(header: Pick<BackupEnvelope, "version" | "kdf">): Uint8Array {
  const { name, salt, N, r, p } = header.kdf;
  return utf8ToBytes(JSON.stringify([header.version, name, salt, N, r, p]));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000; // avoid call-stack limits on large backups
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
