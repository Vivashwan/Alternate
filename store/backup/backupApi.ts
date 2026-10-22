import type { BackupEnvelope } from "@/lib/backup-crypto";
import { sessionStorage } from "@/lib/session-storage";
import { createApi } from "@reduxjs/toolkit/query/react";
import { type AuthState, signedIn, signedOut } from "./authSlice";
import { baseQueryWithReauth } from "./baseQuery";

export type BackupMeta = { contactCount: number; sizeBytes: number; updatedAt: string };
type Credentials = { email: string; password: string };
type TokenPair = { accessToken: string; refreshToken: string; expiresIn: number };

/** Saves the refresh token securely and marks the session signed in after login/register. */
const startSession = async (
  email: string,
  queryFulfilled: Promise<{ data: TokenPair }>,
  dispatch: (action: unknown) => unknown,
  getState: () => unknown,
) => {
  const { data } = await queryFulfilled;
  const { serverUrl } = (getState() as { auth: AuthState }).auth;
  await sessionStorage.saveSession({ serverUrl, email, refreshToken: data.refreshToken });
  dispatch(signedIn({ email, accessToken: data.accessToken }));
};

export const backupApi = createApi({
  reducerPath: "backupApi",
  baseQuery: baseQueryWithReauth,
  tagTypes: ["Backup"],
  endpoints: (build) => ({
    register: build.mutation<TokenPair, Credentials>({
      query: (body) => ({ url: "/auth/register", method: "POST", body }),
      async onQueryStarted({ email }, { queryFulfilled, dispatch, getState }) {
        await startSession(email, queryFulfilled, dispatch, getState).catch(() => {});
      },
    }),

    login: build.mutation<TokenPair, Credentials>({
      query: (body) => ({ url: "/auth/login", method: "POST", body }),
      async onQueryStarted({ email }, { queryFulfilled, dispatch, getState }) {
        await startSession(email, queryFulfilled, dispatch, getState).catch(() => {});
      },
    }),

    logout: build.mutation<void, void>({
      async queryFn(_arg, api, _extra, baseQuery) {
        const refreshToken = await sessionStorage.getRefreshToken();
        // Revoke server-side if we can, but always sign out locally
        if (refreshToken) await baseQuery({ url: "/auth/logout", method: "POST", body: { refreshToken } });
        await sessionStorage.clearTokens();
        api.dispatch(signedOut());
        api.dispatch(backupApi.util.resetApiState());
        return { data: undefined };
      },
    }),

    getBackupMeta: build.query<BackupMeta | null, void>({
      // A 404 just means "no backup yet", not an error worth showing
      async queryFn(_arg, _api, _extra, baseQuery) {
        const result = await baseQuery("/backups/latest/meta");
        if (result.error?.status === 404) return { data: null };
        return result.error ? { error: result.error } : { data: result.data as BackupMeta };
      },
      providesTags: ["Backup"],
    }),

    uploadBackup: build.mutation<BackupMeta, { envelope: BackupEnvelope; contactCount: number }>({
      query: (body) => ({ url: "/backups/latest", method: "PUT", body }),
      invalidatesTags: ["Backup"],
    }),

    downloadBackup: build.mutation<BackupMeta & { envelope: BackupEnvelope }, void>({
      query: () => ({ url: "/backups/latest" }),
    }),

    deleteBackup: build.mutation<void, void>({
      query: () => ({ url: "/backups/latest", method: "DELETE" }),
      invalidatesTags: ["Backup"],
    }),
  }),
});

export const {
  useRegisterMutation,
  useLoginMutation,
  useLogoutMutation,
  useGetBackupMetaQuery,
  useUploadBackupMutation,
  useDownloadBackupMutation,
  useDeleteBackupMutation,
} = backupApi;
