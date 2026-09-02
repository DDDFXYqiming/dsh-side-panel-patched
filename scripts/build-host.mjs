// dsh-side-panel host 构建：src/host/*.ts 经 typescript 擦除类型转译为 lib/*.js
// （transpileModule：仅去类型、不做类型检查；语义零改写）。类型门禁由 `npx tsc --noEmit` 单独负责。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function build(name) {
  const src = readFileSync(join(root, "src", "host", `${name}.ts`), "utf8")
    .replace(/\r\n/g, "\n")
    .trimEnd();
  const out = join(root, "lib", `${name}.js`);
  mkdirSync(dirname(out), { recursive: true });
  const { outputText } = ts.transpileModule(src + "\n", {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      sourceMap: false,
      removeComments: false,
    },
  });
  writeFileSync(out, outputText, "utf8");
  console.log(`built ${name}.ts -> lib/${name}.js (${outputText.length} chars)`);
}

build("index");
build("invariant");
