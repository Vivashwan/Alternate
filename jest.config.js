/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/jest.setup.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/android/", "/ios/", "/backup-server/", "/benchmarks/"],
  // Packages shipped as untranspiled ESM must go through Babel too
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@noble/.*|@reduxjs/toolkit|immer|redux|react-redux)",
  ],
  collectCoverageFrom: [
    "lib/**/*.ts",
    "store/**/*.ts",
    "hooks/**/*.ts",
    "!lib/countries.ts",
    "!**/*.d.ts",
  ],
};
