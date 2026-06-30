import dotenv from 'dotenv';

dotenv.config();

function stripExtension(value) {
  return String(value || '').replace(/\.[^.]+$/, '').trim();
}

function normalizeCheckpointEnvValue(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  if (text.includes('=')) {
    const [, checkpointRaw] = text.split(/=(.+)/, 2);
    return String(checkpointRaw || '').trim();
  }

  return text;
}

function deriveCheckpointAlias(checkpoint) {
  const stem = stripExtension(checkpoint);
  const normalized = stem.toLowerCase();

  if (normalized.includes('miaomiao')) {
    return 'miaomiao';
  }

  if (normalized.includes('reedanima')) {
    return 'reedanima';
  }

  if (normalized.includes('waianima')) {
    return 'waianima';
  }

  return stem;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function toNumberInRange(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function parseModelPresets(value, fallbackCheckpointName) {
  const entries = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const presets = [];

  for (const entry of entries) {
    const [aliasRaw, checkpointRaw] = entry.includes('=')
      ? entry.split(/=(.+)/, 2)
      : [entry, entry];
    const checkpoint = normalizeCheckpointEnvValue(checkpointRaw);
    const alias = String(aliasRaw || '').trim() || deriveCheckpointAlias(checkpoint);

    if (!alias || !checkpoint) {
      continue;
    }

    presets.push({
      name: alias,
      checkpoint,
      aliases: uniqueStrings([alias, checkpoint, stripExtension(checkpoint), deriveCheckpointAlias(checkpoint)])
    });
  }

  if (presets.length > 0) {
    return presets;
  }

  if (fallbackCheckpointName) {
    return [
      {
        name: 'default',
        checkpoint: fallbackCheckpointName
      }
    ];
  }

  return [];
}

const comfyuiCheckpointName = normalizeCheckpointEnvValue(process.env.COMFYUI_CHECKPOINT_NAME || '');
const comfyuiModelPresets = parseModelPresets(
  process.env.COMFYUI_MODEL_PRESETS,
  comfyuiCheckpointName
);

export const config = {
  discordToken: requireEnv('DISCORD_TOKEN'),
  clientId: requireEnv('CLIENT_ID'),
  guildId: requireEnv('GUILD_ID'),

  comfyuiBaseUrl: process.env.COMFYUI_BASE_URL || 'http://127.0.0.1:8188',
  comfyuiCheckpointName,
  comfyuiModelPresets,
  defaultModelName: comfyuiModelPresets[0]?.name || '',

  queueConcurrency: toPositiveInt(process.env.IMAGE_QUEUE_CONCURRENCY, 1),
  maxQueue: toPositiveInt(process.env.IMAGE_MAX_QUEUE, 5),
  generationTimeoutMs: toPositiveInt(process.env.GENERATION_TIMEOUT_MS, 180000),
  webPort: toPositiveInt(process.env.WEB_PORT, 3000),

  wd14PythonPath: process.env.WD14_PYTHON || 'python',
  wd14ModelDir: process.env.WD14_MODEL_DIR || 'data/wd14',
  wd14ModelRepo: process.env.WD14_MODEL_REPO || 'SmilingWolf/wd-swinv2-tagger-v3',
  wd14GeneralThreshold: toNumberInRange(process.env.WD14_GENERAL_THRESHOLD, 0.35, 0, 1),
  wd14CharacterThreshold: toNumberInRange(process.env.WD14_CHARACTER_THRESHOLD, 0.85, 0, 1),
  wd14TimeoutMs: toPositiveInt(process.env.WD14_TIMEOUT_MS, 120000),

  defaultNegativePrompt:
    process.env.DEFAULT_NEGATIVE_PROMPT ||
    'low quality, worst quality, blurry, bad anatomy, bad hands, extra fingers, text, watermark, logo'
};
