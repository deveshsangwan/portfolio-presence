import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    index: "src/index.ts",
    next: "src/next.ts",
    react: "src/react.ts"
  },
  external: ["react"],
  format: ["esm"],
  sourcemap: true,
  splitting: false,
  target: "es2022",
  treeshake: true
});
