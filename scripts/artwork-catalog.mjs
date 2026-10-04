import { readFile } from 'node:fs/promises';
import { parse } from 'acorn';

const modules = new Map();
async function moduleData(name) {
  if (modules.has(name)) return modules.get(name);
  const tree = parse(await readFile(new URL(`../.cache/native/${name}`, import.meta.url), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
  const declarations = new Map(), imports = new Map(), exports = new Map();
  for (const node of tree.body) {
    if (node.type === 'VariableDeclaration') for (const declaration of node.declarations) declarations.set(declaration.id.name, declaration.init);
    if (node.type === 'ImportDeclaration') for (const specifier of node.specifiers) imports.set(specifier.local.name, { module: node.source.value.replace('./', ''), name: specifier.imported.name });
    if (node.type === 'ExportNamedDeclaration') for (const specifier of node.specifiers) exports.set(specifier.exported.name, specifier.local.name);
  }
  const data = { declarations, imports, exports };
  modules.set(name, data);
  return data;
}

async function constant(name, binding) {
  const module = await moduleData(name);
  if (module.declarations.has(binding)) return literal(name, module.declarations.get(binding));
  const imported = module.imports.get(binding);
  if (!imported) throw new Error(`Unknown artwork constant: ${name}:${binding}`);
  const dependency = await moduleData(imported.module);
  return constant(imported.module, dependency.exports.get(imported.name));
}

async function literal(name, node, locals = {}) {
  if (node.type === 'Literal') return node.value;
  if (node.type === 'Identifier') return Object.hasOwn(locals, node.name) ? locals[node.name] : constant(name, node.name);
  if (node.type === 'MemberExpression') return (await literal(name, node.object, locals))[node.computed ? await literal(name, node.property, locals) : node.property.name];
  if (node.type === 'NewExpression' && node.callee.name === 'Set') return new Set(await literal(name, node.arguments[0]));
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node.type === 'UnaryExpression' && node.operator === '-') return -await literal(name, node.argument);
  if (node.type === 'UnaryExpression' && node.operator === '!') return !await literal(name, node.argument);
  if (node.type === 'ArrayExpression') {
    const values = [];
    for (const entry of node.elements) {
      if (entry.type === 'SpreadElement') values.push(...await literal(name, entry.argument));
      else values.push(await literal(name, entry));
    }
    return values;
  }
  if (node.type === 'ObjectExpression') {
    const values = {};
    for (const property of node.properties) {
      if (property.type === 'SpreadElement') Object.assign(values, await literal(name, property.argument));
      else values[property.key.name ?? property.key.value ?? await literal(name, property.key)] = await literal(name, property.value);
    }
    return values;
  }
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.property.name === 'split') {
    return (await literal(name, node.callee.object)).split(await literal(name, node.arguments[0]));
  }
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.property.name === 'map' && node.arguments[0].type === 'ArrowFunctionExpression') {
    const callback = node.arguments[0];
    return Promise.all((await literal(name, node.callee.object)).map(value => literal(name, callback.body, { [callback.params[0].name]: value })));
  }
  throw new Error(`Unsupported artwork catalog expression: ${name}:${node.type}`);
}

export async function artworkCatalog() {
  const native = 'NeonCityPage-BPSPbVZP.js';
  const layouts = await constant(native, 'gn');
  const models = new Set([...await constant(native, 'wr'), ...await constant(native, 'kn'), ...Object.values(await constant(native, 'vr')).flat()]);
  for (const layout of Object.values(layouts)) {
    for (const entry of layout.lots ?? []) models.add(entry[1]);
    for (const entry of [...layout.props ?? [], ...layout.groves ?? []]) models.add(entry[0]);
    for (const entry of layout.objects ?? []) models.add(entry.model);
  }
  const paths = new Set([...models].map(name => `/models/city-neon/${name}.glb`));
  for (const filename of ['stone.png', 'wood-grain.png', 'modern-buildings-night.hdr']) paths.add(`/models/city-neon/${filename}`);
  paths.add('/assets/workstations-v2-pVmukC4H.png');
  const parts = (await moduleData('index-JDqEnY20.js')).declarations.get('t7');
  for (const part of parts.properties) {
    const maximum = part.value.properties.find(property => property.key.name === 'maxId').value.value;
    for (let index = 1; index <= maximum; index++) paths.add(`/characters/${part.key.name}_${index}.png`);
  }
  for (const face of ['male_eyes', 'eyes_pink', 'lips']) for (let index = 1; index <= 5; index++) paths.add(`/characters/${face}_${index}.png`);
  return paths;
}
