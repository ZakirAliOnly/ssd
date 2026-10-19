import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");

/** Test the real server modules while substituting the database/provider boundary. */
export function tsLoader(overrides = {}) {
  const cache = new Map();
  function load(path) {
    const file = resolve(root, path.endsWith(".ts") ? path : `${path}.ts`);
    if (cache.has(file)) return cache.get(file).exports;
    const loaded = { exports: {} };
    cache.set(file, loaded);
    const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const resolveImport = name => {
      if (name in overrides) return overrides[name];
      if (name.startsWith("@/")) return load(name.slice(2));
      if (name.startsWith(".")) return load(resolve(dirname(file), name));
      return require(name);
    };
    new Function("require", "module", "exports", compiled)(resolveImport, loaded, loaded.exports);
    return loaded.exports;
  }
  return load;
}
