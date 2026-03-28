import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const entryFile = path.join(projectRoot, 'worker-src', 'index.js');
const outputFile = path.join(projectRoot, 'userscripts', 'gemini_web_worker.user.js');
const protocolFile = path.join(projectRoot, 'protocol', 'catalog.json');
const packageFile = path.join(projectRoot, 'package.json');

const moduleCache = new Map();
const orderedModules = [];
const importPattern = /^import\s+(?:[\s\S]*?\s+from\s+)?['"](.+?)['"];?\s*$/gm;

async function collectModules(filePath) {
  const absolutePath = path.resolve(filePath);
  if (moduleCache.has(absolutePath)) {
    return;
  }
  moduleCache.set(absolutePath, true);

  const source = await fs.readFile(absolutePath, 'utf-8');
  const importMatches = [...source.matchAll(importPattern)];
  for (const match of importMatches) {
    const dependencyPath = match[1];
    const absoluteDependencyPath = path.resolve(path.dirname(absolutePath), dependencyPath);
    await collectModules(absoluteDependencyPath);
  }

  orderedModules.push({
    filePath: absolutePath,
    source,
  });
}

function transformModule(source) {
  return source
    .replace(importPattern, '')
    .replace(/^export\s+async\s+function\s+/gm, 'async function ')
    .replace(/^export\s+function\s+/gm, 'function ')
    .replace(/^export\s+const\s+/gm, 'const ')
    .replace(/^export\s+let\s+/gm, 'let ')
    .replace(/^export\s+class\s+/gm, 'class ')
    .replace(/^export\s+\{.+?\};?\s*$/gm, '');
}

async function build() {
  await collectModules(entryFile);
  const protocolCatalog = JSON.parse(await fs.readFile(protocolFile, 'utf-8'));
  const packageJson = JSON.parse(await fs.readFile(packageFile, 'utf-8'));
  const transformedModules = orderedModules
    .map((module) => `// ${path.relative(projectRoot, module.filePath)}\n${transformModule(module.source)}`)
    .join('\n\n');

  const output = `// ==UserScript==
// @name         Muzilee Gemini Web Worker
// @namespace    https://muzilee.local
// @version      ${packageJson.version}
// @description  Modular Gemini page worker for the local Muzilee Gemini Skill daemon.
// @match        https://gemini.google.com/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      googleusercontent.com
// @connect      *.googleusercontent.com
// ==/UserScript==

(() => {
  'use strict';

  const WORKER_PROTOCOL_CATALOG = ${JSON.stringify(protocolCatalog, null, 2)};

${transformedModules}

  main({ catalog: WORKER_PROTOCOL_CATALOG });
})();
`;

  await fs.writeFile(outputFile, output, 'utf-8');
  console.log(`built ${path.relative(projectRoot, outputFile)}`);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
