import BiometricLockScreen from "@/components/biometric-lock-screen";
import ErrorBoundary from "@/components/ErrorBoundary";
import CustomNavigationBar from "@/components/navigation-bar";
import { useTheme } from "@/hooks/useTheme";
import { useLockManager } from "@/lib/lock-manager";
import "@/services/sheets"; // Ensure sheets are registered
import { hydrateBackupSession, store } from "@/store/backup/store";
import useContactStore from "@/store/contactStore";
import { ThemeProvider } from "@react-navigation/native";
import { SplashScreen, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SheetProvider } from "react-native-actions-sheet";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { PaperProvider } from "react-native-paper";
import { Provider as ReduxProvider } from "react-redux";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const paperTheme = useTheme();
  const fetchContacts = useContactStore.use.fetchContacts();
  const [isReady, setIsReady] = useState(false);

  // Initialize lock manager
  useLockManager();

  // Start fetching contacts during app initialization (splash screen time)
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Load contacts and any saved backup session in parallel
        await Promise.all([fetchContacts(), hydrateBackupSession()]);
      } catch (error) {
        console.error("Error during app initialization:", error);
      } finally {
        setIsReady(true);
        await SplashScreen.hideAsync();
      }
    };

    initializeApp();
  }, [fetchContacts]);

  if (!isReady) {
    return null; // Keep showing splash screen
  }

  return (
    <ReduxProvider store={store}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ErrorBoundary>
          <PaperProvider theme={paperTheme}>
            <ThemeProvider value={paperTheme}>
              <SheetProvider context="global">
                <Stack
                  screenOptions={{
                    header: (props) => <CustomNavigationBar {...props} />,
                  }}
                >
                  <Stack.Screen
                    name="new-contact"
                    options={{
                      title: "Add Contact",
                      header: (props) => (
                        <CustomNavigationBar {...props} mode="small" />
                      ),
                    }}
                  />
                  <Stack.Screen
                    name="edit-contact"
                    options={{
                      title: "Edit Contact",
                      header: (props) => (
                        <CustomNavigationBar
                          {...props}
                          mode="small"
                          popToTop={true}
                        />
                      ),
                    }}
                  />
                  <Stack.Screen
                    name="settings"
                    options={{
                      title: "Settings",
                    }}
                  />
                </Stack>
                <BiometricLockScreen />
              </SheetProvider>
            </ThemeProvider>
            <StatusBar style={paperTheme.dark ? "light" : "dark"} />
          </PaperProvider>
        </ErrorBoundary>
      </GestureHandlerRootView>
    </ReduxProvider>
  );
}
