import dotenv from 'dotenv';

dotenv.config();

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

function parseModelPresets(value, fallbackCheckpointName) {
  const entries = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const presets = [];

  for (const entry of entries) {
    const [aliasRaw, checkpointRaw] = entry.includes('=')
      ? entry.split('=')
      : [entry, entry];
    const alias = String(aliasRaw || '').trim();
    const checkpoint = String(checkpointRaw || '').trim();

    if (!alias || !checkpoint) {
      continue;
    }

    presets.push({
      name: alias,
      checkpoint
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

const comfyuiCheckpointName = process.env.COMFYUI_CHECKPOINT_NAME || '';
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

  defaultNegativePrompt:
    process.env.DEFAULT_NEGATIVE_PROMPT ||
    'low quality, worst quality, blurry, bad anatomy, bad hands, extra fingers, text, watermark, logo'
};
