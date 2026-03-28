import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCapabilities } from '../../worker-src/runtime/heartbeat.js';
import { buildPageBridgeScriptSource } from '../../worker-src/bridge/download_capture.js';
import { matchesModel, normalizeModelName } from '../../worker-src/features/model/switch_model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const catalog = JSON.parse(await fs.readFile(path.join(projectRoot, 'protocol', 'catalog.json'), 'utf-8'));

test('normalizeModelName resolves aliases from shared catalog', () => {
  assert.equal(normalizeModelName('flash', catalog), 'quick');
  assert.equal(normalizeModelName('thinking', catalog), 'think');
});

test('matchesModel understands Gemini labels', () => {
  assert.equal(matchesModel('Gemini 2.5 Flash', 'quick', catalog), true);
  assert.equal(matchesModel('Gemini 2.5 Pro', 'pro', catalog), true);
});

test('buildCapabilities adds full size feature only when bridge is ready', () => {
  const withBridge = buildCapabilities(catalog, { bridgeReady: true });
  const withoutBridge = buildCapabilities(catalog, { bridgeReady: false });

  assert.equal(withBridge.includes('feature:download_full_size'), false);
  assert.equal(withoutBridge.includes('feature:download_full_size'), false);
});

test('buildCapabilities still advertises preview image tasks without download feature', () => {
  const capabilities = buildCapabilities(catalog, { bridgeReady: true });
  assert.equal(capabilities.includes('task:generate_image'), true);
  assert.equal(capabilities.includes('task:download_latest_image'), true);
});

test('bridge script captures downloads without allowing the browser download to continue', () => {
  const script = buildPageBridgeScriptSource();

  assert.match(script, /let blockNextAnchorClick = false;/);
  assert.match(script, /blockNextAnchorClick = true;/);
  assert.match(script, /if \(blockNextAnchorClick\) \{\s*blockNextAnchorClick = false;\s*return;\s*\}/);
  assert.match(script, /void captureHref\(href, filename\);\s*return;/);
  assert.match(script, /fetch\(href, \{ credentials: 'include' \}\)/);
});
