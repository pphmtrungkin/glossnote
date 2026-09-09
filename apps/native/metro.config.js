const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");
const { wrapWithReanimatedMetroConfig } = require("react-native-reanimated/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// The bundled core dictionary is a .db file, which Metro treats as source
// unless it is declared an asset.
config.resolver.assetExts.push("db");

const uniwindConfig = withUniwindConfig(wrapWithReanimatedMetroConfig(config), {
  cssEntryFile: "./global.css",
  dtsFile: "./uniwind-types.d.ts",
  // The Ochre spot page, plus the Kindle-style reading themes, on top of
  // Uniwind's built-in light/dark.
  // Restart Metro after changing this — the theme union in
  // uniwind-types.d.ts is regenerated from here.
  extraThemes: ["sepia", "green", "ochre"],
});

module.exports = uniwindConfig;
