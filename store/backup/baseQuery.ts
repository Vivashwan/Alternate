import { sessionStorage } from "@/lib/session-storage";
import {
  type BaseQueryFn,
  type FetchArgs,
  fetchBaseQuery,
  type FetchBaseQueryError,
} from "@reduxjs/toolkit/query/react";
import { accessTokenRefreshed, type AuthState, signedOut } from "./authSlice";

type StateWithAuth = { auth: AuthState };
type TokenPair = { accessToken: string; refreshToken: string };

/** Sends requests to the user-configured server with the in-memory access token. */
const rawBaseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = (args, api, extra) => {
  const { serverUrl } = (api.getState() as StateWithAuth).auth;
  if (!serverUrl) {
    return { error: { status: "CUSTOM_ERROR", error: "Set a backup server URL first" } };
  }
  return fetchBaseQuery({
    baseUrl: serverUrl,
    timeout: 30_000,
    prepareHeaders: (headers, { getState }) => {
      const token = (getState() as StateWithAuth).auth.accessToken;
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return headers;
    },
  })(args, api, extra);
};

// Single-flight refresh: if several requests hit a 401 together, they all wait on one
// refresh call instead of each spending (and so revoking) the rotating refresh token.
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(api: Parameters<BaseQueryFn>[1], extra: object): Promise<string | null> {
  const refreshToken = await sessionStorage.getRefreshToken();
  if (!refreshToken) return null;

  const result = await rawBaseQuery(
    { url: "/auth/refresh", method: "POST", body: { refreshToken } },
    api,
    extra,
  );
  if (!result.data) return null;

  const tokens = result.data as TokenPair;
  await sessionStorage.saveRefreshToken(tokens.refreshToken);
  api.dispatch(accessTokenRefreshed(tokens.accessToken));
  return tokens.accessToken;
}

/**
 * On a 401, refresh the access token once and replay the request. If the refresh
 * token is missing, expired or revoked, the user is signed out.
 */
export const baseQueryWithReauth: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extra,
) => {
  let result = await rawBaseQuery(args, api, extra);
  const isAuthRoute = typeof args !== "string" && args.url.startsWith("/auth/");
  if (result.error?.status !== 401 || isAuthRoute) return result;

  refreshInFlight ??= refreshAccessToken(api, extra as object).finally(() => {
    refreshInFlight = null;
  });
  const newToken = await refreshInFlight;

  if (newToken) {
    result = await rawBaseQuery(args, api, extra);
  } else {
    await sessionStorage.clearTokens();
    api.dispatch(signedOut());
  }
  return result;
};
