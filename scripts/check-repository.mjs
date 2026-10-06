import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'README.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'docs/PRODUCT.md',
  'docs/BLUEPRINT.md',
  'docs/WORK-PROMPT.md',
  'docs/DATA-API.md',
  'docs/SECURITY.md',
  'docs/ACCEPTANCE.md',
  'docs/BACKLOG.md',
  'docs/OPEN-QUESTIONS.md',
  'docs/STATUS.md',
  'docs/journal/2026-10-06-foundation.md',
  'docs/adr/0001-architecture-initiale.md',
  'docs/adr/0002-validation-humaine.md',
  'docs/adr/0003-continuite-developpement.md',
];
const failures = [];
for (const file of required) {
  try {
    const contents = await readFile(path.join(root, file), 'utf8');
    if (!contents.trim()) failures.push(file + ': empty');
  } catch {
    failures.push(file + ': missing');
  }
}
async function markdownFiles(dir) {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'coverage'].includes(item.name)) continue;
    const target = path.join(dir, item.name);
    if (item.isDirectory()) files.push(...(await markdownFiles(target)));
    else if (item.name.endsWith('.md')) files.push(target);
  }
  return files;
}
const markdown = await markdownFiles(root);
for (const file of markdown) {
  const contents = await readFile(file, 'utf8');
  for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    const resolved = path.resolve(path.dirname(file), target);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      failures.push(path.relative(root, file) + ': link outside repository ' + target);
      continue;
    }
    try {
      await stat(resolved);
    } catch {
      failures.push(path.relative(root, file) + ': broken link ' + target);
    }
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    required.length +
      ' required documents and ' +
      markdown.length +
      ' Markdown files checked. Internal file links resolve.',
  );
  console.log(
    'This check does not typecheck TypeScript, validate web URLs or execute any production infrastructure.',
  );
}
