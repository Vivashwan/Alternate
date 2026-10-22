import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/**
 * Backup account session. Redux Toolkit handles this server-side state (session +
 * RTK Query cache), while the existing Zustand stores keep local UI and contact state.
 */
export type AuthState = {
  serverUrl: string;
  email: string | null;
  /** In memory only; reissued from the refresh token when it expires or the app restarts */
  accessToken: string | null;
  status: "signedOut" | "signedIn";
};

export const initialAuthState: AuthState = {
  serverUrl: "",
  email: null,
  accessToken: null,
  status: "signedOut",
};

const authSlice = createSlice({
  name: "auth",
  initialState: initialAuthState,
  reducers: {
    serverUrlChanged(state, action: PayloadAction<string>) {
      state.serverUrl = action.payload.trim().replace(/\/+$/, "");
    },
    signedIn(state, action: PayloadAction<{ email: string; accessToken: string }>) {
      state.email = action.payload.email;
      state.accessToken = action.payload.accessToken;
      state.status = "signedIn";
    },
    /** A stored refresh token exists from a previous launch; the access token is fetched lazily */
    sessionRestored(state, action: PayloadAction<{ serverUrl: string; email: string }>) {
      state.serverUrl = action.payload.serverUrl;
      state.email = action.payload.email;
      state.status = "signedIn";
    },
    accessTokenRefreshed(state, action: PayloadAction<string>) {
      state.accessToken = action.payload;
    },
    signedOut(state) {
      state.email = null;
      state.accessToken = null;
      state.status = "signedOut";
    },
  },
});

export const { serverUrlChanged, signedIn, sessionRestored, accessTokenRefreshed, signedOut } = authSlice.actions;
export default authSlice.reducer;
