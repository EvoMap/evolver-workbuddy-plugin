// Mirrors evolver-dsh-plugin src/prime.js so both hosts inject the same
// [Evolution Memory] block: one asset's complete strategy, recalled by text.
// Unlike prime.js, steps are never truncated: the block promises complete
// steps, and the long ones are the code/template contracts that break when cut.
// STRATEGY_MAX_CHARS alone bounds the injection cost.

const TITLE_MAX_CHARS = 80;
const MIN_STRATEGY_STEPS = 4;
const STRATEGY_MAX_CHARS = 4000;
const DEFAULT_MIN_SIMILARITY = 0.3;
const UNSCORED = -1;
const MIN_CJK_TITLE_CHARS = 5;
const CJK_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function recalledAssets(data) {
  const found = [data?.assets, data?.results, data?.payload?.results].find(Array.isArray) ?? [];
  return found.filter((asset) => asset && typeof asset.asset_id === 'string' && asset.asset_id);
}

function strategySteps(asset) {
  const steps = asset?.strategy ?? asset?.payload?.strategy ?? asset?.gene?.strategy;
  const list = Array.isArray(steps) ? steps : [steps];
  return list
    .filter((step) => typeof step === 'string' && step.trim())
    .map((step) => step.trim());
}

function strategyChars(steps) {
  return steps.reduce((total, step) => total + step.length, 0);
}

function trimmedText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

// A Hub short_title is sometimes a truncated fragment (`Object`, `自动化小`), and
// character count cannot tell those from a terse CJK title.
function looksLikeAName(text) {
  if (!text) return false;
  if (CJK_SCRIPT.test(text)) return [...text].length >= MIN_CJK_TITLE_CHARS;
  return /\s/.test(text);
}

function readableNameOf(asset) {
  const title = trimmedText(asset?.short_title);
  if (looksLikeAName(title)) return title.slice(0, TITLE_MAX_CHARS);
  const described = trimmedText(asset?.nl_summary) || trimmedText(asset?.summary);
  if (described) return described.slice(0, TITLE_MAX_CHARS);
  return title || asset?.asset_type || asset?.type || 'Gene';
}

function similarityOf(asset) {
  return typeof asset.similarity === 'number' ? asset.similarity : UNSCORED;
}

// Similarity is advisory and a Proxy that reports none must not filter
// everything out, so only an explicit low score rejects a candidate.
function isRankable(asset, injectedIds, minSimilarity) {
  if (injectedIds.has(asset.asset_id)) return false;
  return !(typeof asset.similarity === 'number' && asset.similarity < minSimilarity);
}

function hasReusableStrategy(steps) {
  return steps.length >= MIN_STRATEGY_STEPS && strategyChars(steps) <= STRATEGY_MAX_CHARS;
}

export function bestStrategy(assets, injectedIds, minSimilarity = DEFAULT_MIN_SIMILARITY) {
  const ranked = assets
    .filter((asset) => isRankable(asset, injectedIds, minSimilarity))
    .sort((left, right) => similarityOf(right) - similarityOf(left));
  for (const asset of ranked) {
    const steps = strategySteps(asset);
    if (hasReusableStrategy(steps)) return { asset, steps };
  }
  return null;
}

export function formatStrategy({ asset, steps }) {
  return [
    `[Evolution Memory] ${readableNameOf(asset)} (EvoMap network):`,
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    'These are the complete steps already recalled from the network, so there is nothing more to search or fetch for this task.',
    `Apply them where they fit, then report the outcome with evolver_asset_reuse_result for ${asset.asset_id}.`
  ].join('\n');
}
