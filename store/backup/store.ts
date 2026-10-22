import { sessionStorage } from "@/lib/session-storage";
import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";
import authReducer, { serverUrlChanged, sessionRestored } from "./authSlice";
import { backupApi } from "./backupApi";

const rootReducer = combineReducers({
  auth: authReducer,
  [backupApi.reducerPath]: backupApi.reducer,
});

export type RootState = ReturnType<typeof rootReducer>;

export function makeStore(preloadedState?: Partial<RootState>) {
  return configureStore({
    reducer: rootReducer,
    preloadedState,
    middleware: (getDefault) => getDefault().concat(backupApi.middleware),
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore["dispatch"];

export const store = makeStore();

/** Restores a signed-in session from secure storage on app start. */
export async function hydrateBackupSession(target: AppStore = store) {
  const session = await sessionStorage.loadSession();
  if (!session) return;
  if (session.hasRefreshToken) {
    target.dispatch(sessionRestored({ serverUrl: session.serverUrl, email: session.email }));
  } else {
    target.dispatch(serverUrlChanged(session.serverUrl));
  }
}

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
