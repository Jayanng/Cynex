export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  // .tsx is listed too: web/src/lib/links.tsx is a .tsx helper
  // imported by links.test.ts, and without it Jest loads the file
  // untransformed through the native ESM loader.
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  transform: { "^.+\\.tsx?$": ["ts-jest", { useESM: true }] },
  // The MCP, console, and agent sources live outside frontend/, so
  // their bare imports (near-api-js, @modelcontextprotocol/sdk, zod)
  // do not resolve from frontend/node_modules by file location. The
  // root node_modules that used to carry them is ambient, not part
  // of a fresh checkout, so Jest also searches frontend/node_modules
  // walking up from the importing file. Plain node_modules stays
  // first, so a checkout that does have root modules resolves
  // exactly as before.
  moduleDirectories: ["node_modules", "frontend/node_modules"],
};
