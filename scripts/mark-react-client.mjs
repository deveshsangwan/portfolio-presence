import { readFile, writeFile } from "node:fs/promises";

const reactEntry = new URL("../dist/react.js", import.meta.url);
const directive = "\"use client\";\n";
const content = await readFile(reactEntry, "utf8");

if (!content.startsWith("\"use client\";") && !content.startsWith("'use client';")) {
  await writeFile(reactEntry, `${directive}${content}`);
}
