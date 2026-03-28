import { clickElement, queryVisible, queryVisibleByText } from '../../dom/query.js';
import { sleep } from '../../dom/wait.js';

function buildModelAliases(catalog) {
  const mapping = new Map();
  const aliases = catalog.models.aliases || {};
  Object.entries(aliases).forEach(([canonical, names]) => {
    mapping.set(canonical, canonical);
    names.forEach((name) => mapping.set(String(name).trim().toLowerCase(), canonical));
  });
  return mapping;
}

export function normalizeModelName(model, catalog) {
  const normalized = String(model || '').trim().toLowerCase();
  if (!normalized) return '';
  const aliases = buildModelAliases(catalog);
  return aliases.get(normalized) || normalized;
}

export function getCurrentModelRaw(selectors) {
  const label = queryVisible(selectors.modelLabel);
  return label ? (label.textContent || '').trim() : '';
}

export function matchesModel(raw, targetModel, catalog) {
  const lower = String(raw || '').trim().toLowerCase();
  const target = normalizeModelName(targetModel, catalog);

  if (target === 'pro') return lower.includes('pro');
  if (target === 'quick') {
    return lower.includes('quick') || lower.includes('fast') || lower.includes('flash') || lower.includes('快速');
  }
  if (target === 'think') {
    return lower.includes('think') || lower.includes('thinking') || lower.includes('思考');
  }
  return false;
}

export function findModelOption(selectors, model, catalog) {
  const normalizedModel = normalizeModelName(model, catalog);
  const direct = queryVisible(selectors.modelOptions[normalizedModel] || []);
  if (direct) {
    return direct;
  }

  return queryVisibleByText((text) => {
    if (!text) return false;
    if (normalizedModel === 'pro') {
      return text.includes('pro');
    }
    if (normalizedModel === 'quick') {
      return text.includes('quick') || text.includes('fast') || text.includes('flash') || text.includes('快速');
    }
    if (normalizedModel === 'think') {
      return text.includes('think') || text.includes('thinking') || text.includes('思考');
    }
    return false;
  });
}

export async function switchModel(selectors, model, catalog) {
  const normalizedModel = normalizeModelName(model, catalog);
  if (!normalizedModel) {
    const currentModel = getCurrentModelRaw(selectors);
    return { ok: true, previous_model: currentModel, current_model: currentModel, changed: false };
  }

  const currentRaw = getCurrentModelRaw(selectors);
  if (matchesModel(currentRaw, normalizedModel, catalog)) {
    return { ok: true, previous_model: currentRaw, current_model: currentRaw, changed: false };
  }

  const modelButton = queryVisible(selectors.modelBtn);
  if (!modelButton) {
    throw new Error('model_btn_not_found');
  }

  clickElement(modelButton);
  await sleep(300);

  const target = findModelOption(selectors, normalizedModel, catalog);
  if (!target) {
    throw new Error(`model_option_${normalizedModel}_not_found`);
  }

  clickElement(target);
  await sleep(900);

  const finalRaw = getCurrentModelRaw(selectors);
  if (!matchesModel(finalRaw, normalizedModel, catalog)) {
    throw new Error(`model_switch_failed:${normalizedModel}`);
  }

  return { ok: true, previous_model: currentRaw, current_model: finalRaw, changed: true };
}

