const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");
const { wrapWithReanimatedMetroConfig } = require("react-native-reanimated/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const uniwindConfig = withUniwindConfig(wrapWithReanimatedMetroConfig(config), {
  cssEntryFile: "./global.css",
  dtsFile: "./uniwind-types.d.ts",
  // Kindle-style reading themes on top of Uniwind's built-in light/dark.
  // Restart Metro after changing this — the theme union in
  // uniwind-types.d.ts is regenerated from here.
  extraThemes: ["sepia", "green"],
});

module.exports = uniwindConfig;
