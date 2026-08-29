// Client bundle build: tsdown (rolldown) CJS output wrapped in the DSH
// __ModuleLoader__ shell, matching lib/client.js's module format:
//   window.__ModuleLoader__.load({ id, factory: (require) => { ...cjs... } })
// react / react-dom / @deepseek-ai/* stay external (platform-provided via
// dsh.client.inject); everything else is inlined.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'tsdown';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const staging = path.join(root, '.tmp-client-build');
const external = ['react', 'react-dom', 'react-dom/client', '@deepseek-ai/dsh-client-ui-primitives'];

await build({
  config: false,
  cwd: root,
  entry: { client: path.join('src', 'client', 'index.ts') },
  outDir: staging,
  format: 'cjs',
  external,
  sourcemap: true,
  target: 'es2022',
  minify: false,
  dts: false,
  clean: true,
  logLevel: 'silent'
});

const bodyRaw = readFileSync(path.join(staging, 'client.cjs'), 'utf8').replace(/\r\n/g, '\n');
const map = JSON.parse(readFileSync(path.join(staging, 'client.cjs.map'), 'utf8'));
// The body is a bare CJS module: tsdown's rolldown no longer declares
// module/exports itself, and the factory closure must be self-contained and
// return its exports (the platform loader reads the factory return value).
const body = bodyRaw.replace(/\n?\/\/# sourceMappingURL=client\.cjs\.map$/, '').replace(/\n+$/, '');
const bodyLines = ['var module = { exports: {} };', 'var exports = module.exports;', ...body.split('\n'), 'return module.exports;'];
// The wrapper adds a 3-line header plus the 2 module/exports declarations
// before the first mapped line; shift the map to stay accurate.
map.mappings = ';;;;;' + map.mappings;

const header = [
  'window.__ModuleLoader__.load({',
  `\tid: ${JSON.stringify(pkg.name)},`,
  '\tfactory: (require) => {'
];
const indented = bodyLines.map((line) => (line === '' ? '' : `\t\t${line}`));
const tail = ['\t}', '});', '', '//# sourceMappingURL=client.js.map'];
writeFileSync(path.join(root, 'lib', 'client.js'), [...header, ...indented, ...tail].join('\n'));
writeFileSync(path.join(root, 'lib', 'client.js.map'), JSON.stringify(map));

rmSync(staging, { recursive: true, force: true });
console.log('client bundle OK');
