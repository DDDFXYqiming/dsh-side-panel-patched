// dsh-side-panel host 构建：把 src/host/*.ts（恢复的源码，本身即合法 ESM JS）
// 原样复制为 lib/*.js。零转换 = 零语义漂移；后续如需类型安全可换 tsdown。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function build(name) {
  const src = readFileSync(join(root, "src", "host", `${name}.ts`), "utf8")
    .replace(/\r\n/g, "\n")
    .trimEnd();
  const out = join(root, "lib", `${name}.js`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, src + "\n", "utf8");
  console.log(`built ${name}.ts -> lib/${name}.js (${src.length} chars)`);
}

build("index");
build("invariant");
