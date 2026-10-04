import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';

const sourceName = 'NeonCityPage-BPSPbVZP.js';
const output = new URL('../src/native/generated/', import.meta.url);
const cache = new URL('../.cache/native/', import.meta.url);
const modules = new Map();
const lockedSources = JSON.parse(await readFile(new URL('native-sources.json', import.meta.url), 'utf8'));
const artwork = JSON.parse(await readFile(new URL('../public/artwork-manifest.json', import.meta.url), 'utf8').catch(() => 'null'));
const assetBase = artwork?.basePath ?? '/native-assets/unprepared';
if (!/^\/native-assets\/([a-f0-9]{16}|unprepared)$/.test(assetBase)) throw new Error('Invalid artwork snapshot');
await mkdir(output, { recursive: true });
await mkdir(cache, { recursive: true });

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`Native scene patch no longer matches: ${before.slice(0,80)}`);
  return source.replace(before, after);
}

async function saveGenerated(name, content) {
  const path = new URL(name, output);
  const existing = await readFile(path, 'utf8').catch(() => null);
  if (existing !== content) await writeFile(path, content);
}

function adapt(source, name) {
  if (name === 'three.module-BGB2N4hT.js') return replaceOnce(source, 'fetch(a).then(t=>', 'modelResponse(a).then(t=>');
  if (name === 'index-JDqEnY20.js') {
    const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const origin = ast.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'Jf');
    return source.slice(0, origin.start) + 'function Jf(){return ``}' + source.slice(origin.end);
  }
  if (name !== sourceName) return source;
  source = replaceOnce(source, 'function Dr(e,t,n,i,a){', 'function Dr(e,t,n,i,a,visitor){let visitorLoad=0;');
  source = replaceOnce(source, 'et.loadAsync(`/models/city-neon/${e}.glb`)', 'visitor.load(()=>et.loadAsync(`/models/city-neon/${e}.glb`))');
  source = replaceOnce(source, 'o.setPixelRatio(1),', 'o.info.autoReset=!1,o.setPixelRatio(1),');
  source = replaceOnce(source, 'g.enableDamping=!0,', 'g.enabled=!1,g.enableDamping=!1,');
  source = replaceOnce(source, 'h.fov=je.radToDeg(2*Math.atan(m/f)),', 'h.fov=72,h.near=.06,');
  source = replaceOnce(source, '||e-Et<1e3/30-1', '');
  source = replaceOnce(source, 'A&&M?.update(e,ue,We.matches,A.heightAt)', 'visitor.frame(e,h,A,g,M,o),o.info.reset(),A&&M?.update(visitor.time(e)+(I?.world.dynamicWorld.tickRateMs??500),ue,We.matches,A.heightAt)');
  source = replaceOnce(source, 'M.sync(Ut(t,n),performance.now(),', 'M.sync(Ut(t,n),t.dynamicWorld.timestamp,');
  source = replaceOnce(source, 'g.update(),re?.update(h)', 're?.update(h)');
  source = replaceOnce(source, 'window.addEventListener(`keydown`,ht),window.addEventListener(`keyup`,_t),', '');
  source = replaceOnce(source, 's.addEventListener(`pointerdown`,bt),s.addEventListener(`pointerup`,wt),', '');
  source = replaceOnce(source, 'z=i,ot(),n({loading:!0,error:null});try{', 'z=i,ot(),n({loading:!0,error:null});const visitorRequest=++visitorLoad;let visitorPending=!0;try{');
  source = replaceOnce(source, 'if(H||i!==z||!ie)return;', 'if(H||i!==z||visitorRequest!==visitorLoad||!ie)return;');
  source = replaceOnce(source, '!H&&i===z&&n({loading:!0,error:null,detail:', '!H&&i===z&&visitorRequest===visitorLoad&&visitorPending&&n({loading:!0,error:null,detail:');
  source = replaceOnce(source, 'st(),at(),n({loading:!1,error:de})', 'st(),await visitor.ready(h,A,g,de?null:i,o,[c,l]);if(H||i!==z||visitorRequest!==visitorLoad)return;x.invalidate(),n({loading:!1,error:de})');
  source = replaceOnce(source, '!H&&i===z&&n({loading:!1,error:e instanceof Error?e.message:String(e)})', 'visitorPending=!1,!H&&i===z&&visitorRequest===visitorLoad&&n({loading:!1,error:e instanceof Error?e.message:String(e)})');
  source = replaceOnce(source, 'setWorld:ct,select(e,t)', 'setWorld:ct,retry(){if(I){z=null;return ct(I.world,I.space)}},select(e,t)');
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const renderer = ast.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'Dr');
  const inspector = renderer.body.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'St');
  source = source.slice(0, inspector.start) + 'function St(){}' + source.slice(inspector.end);
  source = replaceOnce(source, 's=2.405/Math.hypot(f.x,f.z)', 's=2.405');
  source = replaceOnce(source, 'b.render()}return Ot()', 'b.render(),visitor.rendered?.()}return Ot()');
  source = replaceOnce(source, 'if(document.hidden||H||!A)return;', 'if(document.hidden||H||!A||!visitor.active())return;');
  return source;
}

async function load(name) {
  if (modules.has(name)) return modules.get(name);
  if (!/^[a-zA-Z0-9_-]+(?:\.module)?-[a-zA-Z0-9_-]+\.js$/.test(name)) throw new Error(`Unsupported native dependency: ${name}`);
  if (!lockedSources[name]) throw new Error(`Unreviewed native source: ${name}`);
  let original;
  try { original = await readFile(new URL(name, cache), 'utf8'); }
  catch {
    const response = await fetch(`https://www.midnight.city/assets/${name}`, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Native source unavailable: ${name} (${response.status})`);
    original = await response.text();
    await writeFile(new URL(name, cache), original);
  }
  const hash = createHash('sha256').update(original).digest('hex');
  if (lockedSources[name] !== hash) throw new Error(`Native source content changed: ${name}`);
  const source = adapt(original, name);
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
  const scopes = analyze(ast, { ecmaVersion: 2024, sourceType: 'module' });
  const scope = scopes.scopes.find(scope => scope.type === 'module');
  const declarations = new Map();
  const imports = new Map();
  const exports = new Map();
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers) imports.set(specifier.local.name, { node, specifier });
    } else if (node.type === 'VariableDeclaration') {
      for (const declaration of node.declarations) {
        const bindings = scope.variables.filter(variable => variable.defs.some(definition => definition.node === declaration));
        for (const binding of bindings) declarations.set(binding.name, { node: declaration, kind: node.kind });
      }
    } else if (node.id) declarations.set(node.id.name, { node });
    else if (node.type === 'ExportNamedDeclaration') {
      for (const specifier of node.specifiers) exports.set(specifier.exported.name, specifier.local.name);
    }
  }
  const module = { name, source, ast, scope, declarations, imports, exports, selected: new Set(), imported: new Map(), expressions: new Set(), hash };
  modules.set(name, module);
  return module;
}

async function references(module, node) {
  for (const variable of module.scope.variables) {
    if (variable.references.some(reference => reference.identifier.start >= node.start && reference.identifier.end <= node.end)) await select(module, variable.name);
  }
}

async function select(module, name) {
  if (module.selected.has(name)) return;
  module.selected.add(name);
  const imported = module.imports.get(name);
  if (imported) {
    const dependency = await load(imported.node.source.value.replace(/^\.\//, ''));
    const exported = imported.specifier.imported.name;
    const binding = dependency.exports.get(exported);
    if (!binding) throw new Error(`Missing native export ${dependency.name}:${exported}`);
    module.imported.set(name, { dependency, exported });
    await select(dependency, binding);
  } else {
    const declaration = module.declarations.get(name);
    if (!declaration) throw new Error(`Missing native binding ${module.name}:${name}`);
    await references(module, declaration.node);
  }
}

await select(await load(sourceName), 'Dr');
let changed = true;
while (changed) {
  changed = false;
  for (const module of modules.values()) {
    if (module.name.startsWith('index-')) continue;
    for (const node of module.ast.body) {
      if (node.type !== 'ExpressionStatement' || module.expressions.has(node)) continue;
      if (module.scope.variables.some(variable => module.selected.has(variable.name) && variable.references.some(reference => reference.identifier.start >= node.start && reference.identifier.end <= node.end))) {
        module.expressions.add(node);
        await references(module, node);
        changed = true;
      }
    }
  }
}

const manifest = [];
for (const module of modules.values()) {
  const chunks = [];
  if (module.name === 'three.module-BGB2N4hT.js') chunks.push("import { modelResponse } from '../../model-response';");
  for (const [name, { dependency, exported }] of module.imported) chunks.push(`import { ${exported} as ${name} } from './${dependency.name}';`);
  const nodes = [...module.selected].flatMap(name => {
    const declaration = module.declarations.get(name);
    return declaration ? [declaration] : [];
  }).concat([...module.expressions].map(node => ({ node })));
  nodes.sort((left, right) => left.node.start - right.node.start);
  const written = new Set();
  for (const { node, kind } of nodes) {
    if (written.has(node)) continue;
    written.add(node);
    chunks.push(`${kind ? `${kind} ` : ''}${module.source.slice(node.start, node.end)}${kind ? ';' : ''}`);
  }
  const exports = [...module.exports].filter(([, binding]) => module.selected.has(binding)).map(([name, binding]) => `${binding} as ${name}`);
  if (module.name === sourceName) exports.push('Dr as createNativeScene');
  chunks.push(`export { ${exports.join(', ')} };`);
  let result = chunks.join('\n');
  result = result.replaceAll('/models/city-neon/', `${assetBase}/models/city-neon/`).replaceAll('`/characters`', `\`${assetBase}/characters\``).replaceAll('/api/characters/', `${assetBase}/api/characters/`).replaceAll('/api/building-models/', `${assetBase}/api/building-models/`).replaceAll('/assets/workstations-v2-pVmukC4H.png', `${assetBase}/assets/workstations-v2-pVmukC4H.png`);
  await saveGenerated(module.name, result);
  manifest.push({ file: module.name, sha256: module.hash, bindings: [...module.selected].sort() });
}
await saveGenerated('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`Prepared rendering-only native scene (${manifest.length} modules); no original app entry point.`);
