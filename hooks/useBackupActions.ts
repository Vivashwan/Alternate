import { decryptContacts, encryptContacts } from "@/lib/backup-crypto";
import { useDownloadBackupMutation, useUploadBackupMutation } from "@/store/backup/backupApi";
import useContactStore from "@/store/contactStore";
import { useCallback, useState } from "react";

type Phase = "idle" | "encrypting" | "uploading" | "downloading" | "decrypting" | "saving";

/**
 * Glue between the three layers of a backup: Zustand (contacts on the device),
 * client-side encryption, and RTK Query (the server). Encryption and decryption
 * always happen on the device.
 */
export function useBackupActions() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadBackup] = useUploadBackupMutation();
  const [downloadBackup] = useDownloadBackupMutation();

  const backUp = useCallback(
    async (passphrase: string) => {
      try {
        const contacts = useContactStore.getState().contacts;
        setPhase("encrypting");
        const envelope = await encryptContacts(contacts, passphrase);
        setPhase("uploading");
        return await uploadBackup({ envelope, contactCount: contacts.length }).unwrap();
      } finally {
        setPhase("idle");
      }
    },
    [uploadBackup],
  );

  /** Restores the latest backup, adding contacts that aren't already on the device. */
  const restore = useCallback(
    async (passphrase: string) => {
      try {
        setPhase("downloading");
        const { envelope } = await downloadBackup().unwrap();
        setPhase("decrypting");
        const contacts = await decryptContacts(envelope, passphrase);
        setPhase("saving");
        const added = await useContactStore.getState().mergeContacts(contacts);
        return { restored: contacts.length, added };
      } finally {
        setPhase("idle");
      }
    },
    [downloadBackup],
  );

  return { backUp, restore, phase, busy: phase !== "idle" };
}
