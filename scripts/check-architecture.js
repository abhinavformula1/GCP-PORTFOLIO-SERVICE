'use strict';

const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');
const acorn = require('acorn');

const SOURCE_EXTENSIONS = ['.js', '.cjs', '.mjs'];
const KNOWN_LAYERS = new Set(['domain', 'application', 'interfaces', 'infrastructure', 'main']);
const INTERFACE_PACKAGES = new Set(['express', 'express-rate-limit', 'express-validator', 'multer']);
const NODE_BUILTINS = new Set(builtinModules.concat(builtinModules.map((name) => `node:${name}`)));

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    if ((entry.isFile() || entry.isSymbolicLink())
      && SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
      return [absolute];
    }
    return [];
  });
}

function resolveLocal(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => base + extension),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
    } catch (_) {}
  }
  return null;
}

function parseSource(source, filename = 'source.js') {
  const extension = path.extname(filename);
  const sourceTypes = extension === '.cjs'
    ? ['script']
    : extension === '.mjs'
      ? ['module']
      : ['module', 'script'];
  let lastError;
  for (const sourceType of sourceTypes) {
    try {
      return acorn.parse(source, {
        ecmaVersion: 'latest',
        sourceType,
        allowHashBang: true,
        allowAwaitOutsideFunction: true,
        locations: true,
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function visitAst(node, visitor) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) {
      value.forEach((child) => visitAst(child, visitor));
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      visitAst(value, visitor);
    }
  }
}

function literalString(node) {
  return node && node.type === 'Literal' && typeof node.value === 'string'
    ? node.value
    : null;
}

function isIdentifier(node, name) {
  return !!node && node.type === 'Identifier' && node.name === name;
}

function memberPropertyName(node) {
  if (!node || node.type !== 'MemberExpression') return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  return literalString(node.property);
}

function analyzeSource(source, filename = 'source.js') {
  const ast = parseSource(source, filename);
  const imports = [];
  const dynamicLoads = [];
  const processAliases = new Set(['process']);
  const envAliases = new Set();
  let aliasesChanged = true;

  function isProcessExpression(node) {
    if (node && node.type === 'Identifier' && processAliases.has(node.name)) return true;
    if (isProcessModuleCall(node)) return true;
    return node
      && node.type === 'MemberExpression'
      && (isIdentifier(node.object, 'globalThis') || isIdentifier(node.object, 'global'))
      && memberPropertyName(node) === 'process';
  }

  function isProcessModuleCall(node) {
    return node
      && node.type === 'CallExpression'
      && isIdentifier(node.callee, 'require')
      && node.arguments.length === 1
      && ['process', 'node:process'].includes(literalString(node.arguments[0]));
  }

  function isEnvironmentExpression(node) {
    return node
      && node.type === 'MemberExpression'
      && isProcessExpression(node.object)
      && memberPropertyName(node) === 'env';
  }

  while (aliasesChanged) {
    aliasesChanged = false;
    visitAst(ast, (node) => {
      if (node.type === 'ImportDeclaration'
        && ['process', 'node:process'].includes(node.source.value)) {
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier' && specifier.imported.name === 'env') {
            if (!envAliases.has(specifier.local.name)) {
              envAliases.add(specifier.local.name);
              aliasesChanged = true;
            }
          } else if (!processAliases.has(specifier.local.name)) {
            processAliases.add(specifier.local.name);
            aliasesChanged = true;
          }
        }
      }
      if (node.type !== 'VariableDeclarator' && node.type !== 'AssignmentExpression') return;
      const target = node.type === 'VariableDeclarator' ? node.id : node.left;
      const value = node.type === 'VariableDeclarator' ? node.init : node.right;
      if (!target || !value) return;
      if (target.type === 'Identifier'
        && (isProcessExpression(value) || isProcessModuleCall(value))
        && !processAliases.has(target.name)) {
        processAliases.add(target.name);
        aliasesChanged = true;
      }
      if (target.type === 'Identifier' && isEnvironmentExpression(value) && !envAliases.has(target.name)) {
        envAliases.add(target.name);
        aliasesChanged = true;
      }
      if (target.type === 'ObjectPattern'
        && (isProcessExpression(value) || isProcessModuleCall(value))) {
        for (const property of target.properties || []) {
          if (property.type === 'Property'
            && (property.key.name === 'env' || property.key.value === 'env')
            && property.value.type === 'Identifier'
            && !envAliases.has(property.value.name)) {
            envAliases.add(property.value.name);
            aliasesChanged = true;
          }
        }
      }
    });
  }

  let environmentAccess = envAliases.size > 0;
  visitAst(ast, (node) => {
    if (node.type === 'ImportDeclaration'
      || node.type === 'ExportNamedDeclaration'
      || node.type === 'ExportAllDeclaration') {
      if (node.source) imports.push(node.source.value);
      return;
    }
    if (node.type === 'ImportExpression') {
      const specifier = literalString(node.source);
      if (specifier == null) dynamicLoads.push({ kind: 'import()', loc: node.loc.start });
      else imports.push(specifier);
      return;
    }
    if (node.type === 'CallExpression') {
      const isRequire = isIdentifier(node.callee, 'require');
      const isRequireResolve = node.callee.type === 'MemberExpression'
        && isIdentifier(node.callee.object, 'require')
        && memberPropertyName(node.callee) === 'resolve';
      if (isRequire || isRequireResolve) {
        const specifier = node.arguments.length === 1 ? literalString(node.arguments[0]) : null;
        if (specifier == null) {
          dynamicLoads.push({
            kind: isRequireResolve ? 'require.resolve()' : 'require()',
            loc: node.loc.start,
          });
        } else {
          imports.push(specifier);
        }
      }
      const moduleRequire = node.callee.type === 'MemberExpression'
        && isIdentifier(node.callee.object, 'module')
        && memberPropertyName(node.callee) === 'require';
      const indirectRequire = node.callee.type === 'MemberExpression'
        && isIdentifier(node.callee.object, 'require')
        && memberPropertyName(node.callee) !== 'resolve';
      if (moduleRequire || indirectRequire) {
        dynamicLoads.push({ kind: 'indirect require loading', loc: node.loc.start });
      }
      if (isIdentifier(node.callee, 'eval') || isIdentifier(node.callee, 'Function')) {
        dynamicLoads.push({ kind: 'runtime code generation', loc: node.loc.start });
      }
      const reflectGet = node.callee.type === 'MemberExpression'
        && isIdentifier(node.callee.object, 'Reflect')
        && memberPropertyName(node.callee) === 'get';
      if (reflectGet && isProcessExpression(node.arguments[0])) {
        const property = literalString(node.arguments[1]);
        if (property === 'env' || property == null) environmentAccess = true;
      }
    }
    if (node.type === 'NewExpression' && isIdentifier(node.callee, 'Function')) {
      dynamicLoads.push({ kind: 'runtime code generation', loc: node.loc.start });
    }
    if ((node.type === 'VariableDeclarator' || node.type === 'AssignmentExpression')) {
      const value = node.type === 'VariableDeclarator' ? node.init : node.right;
      if (isIdentifier(value, 'require')) {
        dynamicLoads.push({ kind: 'require aliasing', loc: node.loc.start });
      }
      if (node.type === 'VariableDeclarator'
        && node.id.type === 'ObjectPattern'
        && value
        && value.type === 'CallExpression'
        && isIdentifier(value.callee, 'require')
        && ['module', 'node:module'].includes(literalString(value.arguments[0]))) {
        const createsLoader = node.id.properties.some((property) =>
          property.type === 'Property'
          && (property.key.name === 'createRequire' || property.key.value === 'createRequire'));
        if (createsLoader) dynamicLoads.push({ kind: 'createRequire() loader', loc: node.loc.start });
      }
    }
    if (node.type === 'ImportDeclaration'
      && ['module', 'node:module'].includes(node.source.value)
      && node.specifiers.some((specifier) =>
        specifier.type === 'ImportSpecifier' && specifier.imported.name === 'createRequire')) {
      dynamicLoads.push({ kind: 'createRequire() loader', loc: node.loc.start });
    }
    if (isEnvironmentExpression(node)) environmentAccess = true;
    if (node.type === 'MemberExpression'
      && isProcessExpression(node.object)
      && node.computed
      && memberPropertyName(node) == null) {
      environmentAccess = true;
    }
  });

  return {
    imports: [...new Set(imports)],
    dynamicLoads,
    environmentAccess,
  };
}

function collectImports(source, filename) {
  return analyzeSource(source, filename).imports;
}

function layerOf(srcRoot, file) {
  return path.relative(srcRoot, file).split(path.sep)[0];
}

function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function packageRoot(specifier) {
  const parts = String(specifier || '').split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function isBuiltin(specifier) {
  if (NODE_BUILTINS.has(specifier)) return true;
  if (specifier.startsWith('node:')) return NODE_BUILTINS.has(specifier.slice(5));
  return false;
}

function findCycles(graph) {
  const cycles = [];
  const visited = new Set();
  const active = new Set();
  const stack = [];
  function visit(node) {
    if (active.has(node)) {
      const index = stack.indexOf(node);
      cycles.push(stack.slice(index).concat(node));
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    active.add(node);
    stack.push(node);
    for (const target of graph.get(node) || []) visit(target);
    stack.pop();
    active.delete(node);
  }
  for (const node of graph.keys()) visit(node);
  return cycles;
}

function checkArchitecture(options = {}) {
  const repositoryRoot = fs.realpathSync(path.resolve(options.repositoryRoot || path.join(__dirname, '..')));
  const srcRoot = fs.realpathSync(path.resolve(options.srcRoot || path.join(repositoryRoot, 'src')));
  const envAllowed = new Set((options.envAllowed || [
    path.join(srcRoot, 'infrastructure/config/index.js'),
  ]).map((file) => path.resolve(file)));
  let projectName = '';
  try {
    projectName = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')).name || '';
  } catch (_) {}
  const failures = [];
  const graph = new Map();
  const files = walk(srcRoot);

  for (const file of files) {
    const relative = path.relative(repositoryRoot, file);
    let realFile;
    try {
      realFile = fs.realpathSync(file);
    } catch (_) {
      failures.push(`${relative}: source file cannot be resolved`);
      continue;
    }
    if (!isInside(srcRoot, realFile)) {
      failures.push(`${relative}: source symlink/path escapes src`);
      continue;
    }
    const layer = layerOf(srcRoot, file);
    if (!KNOWN_LAYERS.has(layer)) {
      failures.push(`${relative}: unknown top-level source layer "${layer}"`);
      continue;
    }
    const source = fs.readFileSync(file, 'utf8');
    let analysis;
    try {
      analysis = analyzeSource(source, file);
    } catch (error) {
      const location = error.loc ? `${error.loc.line}:${error.loc.column + 1}` : 'unknown';
      failures.push(`${relative}:${location}: JavaScript parse error: ${error.message}`);
      graph.set(realFile, []);
      continue;
    }
    if (analysis.environmentAccess && !envAllowed.has(path.resolve(file))) {
      failures.push(`${relative}: process.env access is not allowed here (including aliases/indirection)`);
    }
    for (const load of analysis.dynamicLoads) {
      failures.push(
        `${relative}:${load.loc.line}:${load.loc.column + 1}: non-literal ${load.kind} is not allowed in src`
      );
    }
    const edges = [];
    for (const specifier of analysis.imports) {
      const local = specifier.startsWith('.');
      if (!local) {
        if (path.isAbsolute(specifier) || specifier.startsWith('file:') || specifier.startsWith('#')) {
          failures.push(`${relative}: path/alias import may bypass src boundaries: "${specifier}"`);
          continue;
        }
        if (projectName && packageRoot(specifier) === projectName) {
          failures.push(`${relative}: root-level bridge/self import is not allowed: "${specifier}"`);
          continue;
        }
        if ((layer === 'domain' || layer === 'application')) {
          failures.push(`${relative}: ${layer} must not import external package "${specifier}"`);
        } else if (layer === 'interfaces'
          && !isBuiltin(specifier)
          && !INTERFACE_PACKAGES.has(packageRoot(specifier))) {
          failures.push(`${relative}: interfaces may not import external I/O package "${specifier}"`);
        }
        continue;
      }
      const candidate = path.resolve(path.dirname(file), specifier);
      if (!isInside(srcRoot, candidate)) {
        const bridge = isInside(repositoryRoot, candidate) ? ' (root-level bridge imports are not allowed)' : '';
        failures.push(`${relative}: local import escapes src${bridge}: "${specifier}"`);
        continue;
      }
      const target = resolveLocal(file, specifier);
      if (!target) {
        failures.push(`${relative}: unresolved local import "${specifier}"`);
        continue;
      }
      if (!isInside(srcRoot, target)) {
        failures.push(`${relative}: symlink/path import escapes src: "${specifier}"`);
        continue;
      }
      edges.push(target);
      const targetLayer = layerOf(srcRoot, target);
      if (layer === 'domain' && targetLayer !== 'domain') {
        failures.push(`${relative}: domain must not depend on ${targetLayer}`);
      }
      if (layer === 'application' && !['application', 'domain'].includes(targetLayer)) {
        failures.push(`${relative}: application must not depend on ${targetLayer}`);
      }
      if (layer === 'interfaces' && ['infrastructure', 'main'].includes(targetLayer)) {
        failures.push(`${relative}: interfaces must not depend on ${targetLayer}`);
      }
      if (layer === 'infrastructure' && ['interfaces', 'main'].includes(targetLayer)) {
        failures.push(`${relative}: infrastructure must not depend on ${targetLayer}`);
      }
    }
    graph.set(realFile, edges);
  }

  for (const cycle of findCycles(graph)) {
    failures.push(`dependency cycle: ${cycle.map((file) => path.relative(repositoryRoot, file)).join(' -> ')}`);
  }
  return { ok: failures.length === 0, failures, files };
}

function runCli() {
  const result = checkArchitecture();
  if (!result.ok) {
    console.error('Architecture boundary violations:');
    result.failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log(`Architecture boundaries passed (${result.files.length} source files).`);
}

if (require.main === module) runCli();

module.exports = {
  analyzeSource,
  checkArchitecture,
  collectImports,
  resolveLocal,
  findCycles,
  runCli,
};
