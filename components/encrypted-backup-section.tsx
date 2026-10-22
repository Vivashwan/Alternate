import { useBackupActions } from "@/hooks/useBackupActions";
import { WrongPassphraseError } from "@/lib/backup-crypto";
import { serverUrlChanged } from "@/store/backup/authSlice";
import {
  useGetBackupMetaQuery,
  useLoginMutation,
  useLogoutMutation,
  useRegisterMutation,
} from "@/store/backup/backupApi";
import { useAppDispatch, useAppSelector } from "@/store/backup/store";
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button, HelperText, Text, TextInput, useTheme } from "react-native-paper";

type Props = {
  /** Shows a result or error dialog (the settings screen's existing dialog) */
  onMessage: (title: string, content: string) => void;
};

/** Reads the server's error message from an RTK Query error, if there is one. */
export function describeError(error: unknown): string {
  const err = error as { status?: unknown; data?: { message?: string }; error?: string };
  if (err?.data?.message) return err.data.message;
  if (err?.status === "FETCH_ERROR") return "Could not reach the backup server";
  if (err?.status === "TIMEOUT_ERROR") return "The backup server took too long to respond";
  if (error instanceof Error) return error.message;
  return err?.error ?? "Something went wrong";
}

/**
 * Opt-in, end-to-end encrypted backup to a self-hosted server (see backup-server/).
 * Contacts are encrypted on the device with a passphrase that never leaves it.
 */
export function EncryptedBackupSection({ onMessage }: Props) {
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const { serverUrl, email, status } = useAppSelector((s) => s.auth);
  const signedIn = status === "signedIn";

  const [emailInput, setEmailInput] = useState("");
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");

  const [login, loginState] = useLoginMutation();
  const [register, registerState] = useRegisterMutation();
  const [logout] = useLogoutMutation();
  const meta = useGetBackupMetaQuery(undefined, { skip: !signedIn });
  const { backUp, restore, busy, phase } = useBackupActions();

  const authBusy = loginState.isLoading || registerState.isLoading;
  const canAuthenticate = serverUrl.startsWith("http") && emailInput.includes("@") && password.length >= 10;
  const passphraseValid = passphrase.length >= 8;

  const authenticate = async (action: typeof login | typeof register) => {
    try {
      await action({ email: emailInput.trim(), password }).unwrap();
      setPassword("");
    } catch (error) {
      onMessage("Sign-in failed", describeError(error));
    }
  };

  const handleBackUp = async () => {
    try {
      const result = await backUp(passphrase);
      onMessage("Backup complete", `${result.contactCount} contacts were encrypted and uploaded.`);
    } catch (error) {
      onMessage("Backup failed", describeError(error));
    }
  };

  const handleRestore = async () => {
    try {
      const { restored, added } = await restore(passphrase);
      onMessage("Restore complete", `${restored} contacts in backup, ${added} new contacts added.`);
    } catch (error) {
      onMessage(
        "Restore failed",
        error instanceof WrongPassphraseError ? "That passphrase doesn't match this backup." : describeError(error),
      );
    }
  };

  return (
    <View style={styles.card}>
      <View style={[styles.header, { backgroundColor: theme.colors.inverseOnSurface }]}>
        <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
          Encrypted Cloud Backup
        </Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          Optional. Encrypted on this device; your server only stores ciphertext.
        </Text>
      </View>

      <View style={[styles.body, { backgroundColor: theme.colors.inverseOnSurface }]}>
        {!signedIn ? (
          <>
            <TextInput
              mode="outlined"
              label="Server URL"
              accessibilityLabel="Server URL"
              placeholder="https://backup.example.com"
              autoCapitalize="none"
              keyboardType="url"
              value={serverUrl}
              onChangeText={(text) => dispatch(serverUrlChanged(text))}
            />
            <TextInput
              mode="outlined"
              label="Email"
              accessibilityLabel="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              value={emailInput}
              onChangeText={setEmailInput}
            />
            <TextInput
              mode="outlined"
              label="Account password"
              accessibilityLabel="Account password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <HelperText type="info">At least 10 characters.</HelperText>
            <View style={styles.row}>
              <Button
                mode="outlined"
                style={styles.flex}
                disabled={!canAuthenticate || authBusy}
                loading={registerState.isLoading}
                onPress={() => authenticate(register)}
              >
                Create account
              </Button>
              <Button
                mode="contained"
                style={styles.flex}
                disabled={!canAuthenticate || authBusy}
                loading={loginState.isLoading}
                onPress={() => authenticate(login)}
              >
                Sign in
              </Button>
            </View>
          </>
        ) : (
          <>
            <Text variant="bodyMedium">Signed in as {email}</Text>
            <Text variant="bodySmall" testID="backup-status" style={{ color: theme.colors.onSurfaceVariant }}>
              {meta.isFetching
                ? "Checking last backup…"
                : meta.data
                  ? `Last backup: ${new Date(meta.data.updatedAt).toLocaleString()} · ${meta.data.contactCount} contacts`
                  : "No backup yet"}
            </Text>

            <TextInput
              mode="outlined"
              label="Backup passphrase"
              accessibilityLabel="Backup passphrase"
              secureTextEntry
              value={passphrase}
              onChangeText={setPassphrase}
            />
            <HelperText type={passphrase && !passphraseValid ? "error" : "info"}>
              At least 8 characters. Never sent to the server; a lost passphrase can't be recovered.
            </HelperText>

            <View style={styles.row}>
              <Button
                mode="outlined"
                style={styles.flex}
                icon="cloud-download"
                disabled={!passphraseValid || busy || !meta.data}
                loading={busy && phase !== "encrypting" && phase !== "uploading"}
                onPress={handleRestore}
              >
                Restore
              </Button>
              <Button
                mode="contained"
                style={styles.flex}
                icon="cloud-upload"
                disabled={!passphraseValid || busy}
                loading={phase === "encrypting" || phase === "uploading"}
                onPress={handleBackUp}
              >
                Back up now
              </Button>
            </View>
            <Button mode="text" onPress={() => logout()} disabled={busy}>
              Sign out
            </Button>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 2, marginTop: 24 },
  header: { borderRadius: 16, borderBottomLeftRadius: 5, borderBottomRightRadius: 5, padding: 16, gap: 4 },
  body: { borderRadius: 16, borderTopLeftRadius: 5, borderTopRightRadius: 5, padding: 16, gap: 8 },
  row: { flexDirection: "row", gap: 12 },
  flex: { flex: 1 },
});
