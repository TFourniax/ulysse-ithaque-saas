// Detects circular dependencies between workspace packages and between source modules.
// Uses the TypeScript resolver so `.ts` specifiers and workspace exports resolve like tsc does.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

async function workspaces() {
  const result = [];
  for (const group of ['packages', 'apps']) {
    for (const entry of await readdir(path.join(root, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, group, entry.name);
      try {
        const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
        result.push({ dir, manifest });
      } catch {
        // Directory without a manifest is not a workspace.
      }
    }
  }
  return result;
}

function findCycles(graph) {
  const cycles = [];
  const state = new Map();
  const stack = [];
  function visit(node) {
    state.set(node, 'visiting');
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === 'visiting') cycles.push([...stack.slice(stack.indexOf(next)), next]);
      else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(node, 'done');
  }
  for (const node of graph.keys()) if (!state.has(node)) visit(node);
  return cycles;
}

const all = await workspaces();
const names = new Set(all.map((w) => w.manifest.name));
const packageGraph = new Map(
  all.map((w) => [
    w.manifest.name,
    Object.keys({ ...w.manifest.dependencies, ...w.manifest.devDependencies }).filter((d) =>
      names.has(d),
    ),
  ]),
);
for (const cycle of findCycles(packageGraph))
  failures.push('workspace cycle: ' + cycle.join(' -> '));

async function sourceFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (
      ['node_modules', 'dist', 'coverage', 'test-results', 'playwright-report'].includes(entry.name)
    )
      continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(target)));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(target);
  }
  return files;
}

const options = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  allowImportingTsExtensions: true,
  customConditions: ['ulysse-source'],
  jsx: ts.JsxEmit.ReactJSX,
};
const host = ts.createCompilerHost(options);
const moduleGraph = new Map();
let fileCount = 0;
for (const w of all) {
  for (const file of await sourceFiles(w.dir)) {
    fileCount += 1;
    const text = await readFile(file, 'utf8');
    const imports = ts.preProcessFile(text, true, true).importedFiles.map((i) => i.fileName);
    const edges = [];
    for (const specifier of imports) {
      const resolved = ts.resolveModuleName(specifier, file, options, host).resolvedModule;
      if (
        resolved &&
        !resolved.isExternalLibraryImport &&
        resolved.resolvedFileName.startsWith(root)
      ) {
        edges.push(path.relative(root, resolved.resolvedFileName));
      } else if (
        resolved?.resolvedFileName &&
        !resolved.resolvedFileName.includes('node_modules')
      ) {
        edges.push(path.relative(root, resolved.resolvedFileName));
      }
    }
    moduleGraph.set(path.relative(root, file), edges);
  }
}
for (const cycle of findCycles(moduleGraph)) failures.push('module cycle: ' + cycle.join(' -> '));

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `No circular dependency: ${packageGraph.size} workspaces, ${fileCount} source files checked.`,
  );
}
