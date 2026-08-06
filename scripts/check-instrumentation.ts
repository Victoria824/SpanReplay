import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { validateServiceManifest } from "../packages/observability-sdk/src/index.js";

async function findManifests(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return findManifests(candidate);
    return entry.name === "observability.manifest.json" ? [candidate] : [];
  }));
  return nested.flat();
}

const roots = ["examples", "observability/service-manifests"];
const files = (await Promise.all(roots.map(async (root) => {
  try {
    return await findManifests(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}))).flat().sort();
if (files.length === 0) throw new Error("No observability manifests were found");

const services = new Set<string>();
for (const file of files) {
  try {
    const manifest = validateServiceManifest(JSON.parse(await readFile(file, "utf8")));
    if (services.has(manifest.service.name)) throw new Error(`duplicate service.name ${manifest.service.name}`);
    services.add(manifest.service.name);
    console.log(`PASS ${manifest.service.name} (${file})`);
  } catch (error) {
    throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
console.log(`INSTRUMENTATION CONFORMANT: ${services.size} service manifest(s)`);
