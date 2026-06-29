export const PROMPT_PRESETS = {
  kanna: {
    prompt:
      '1girl, solo, adult woman, delicate face, blue-violet eyes, soft blush, playful teasing expression, long brown hair, very long hair, high twin tails, layered bangs, blue and purple gradient inner hair, vivid blue-purple hair streaks, silky glossy hair, fluffy black cat ears, cat ears only, long fluffy cat tail, tail with blue-purple gradient tip, multiple earrings, blue nail polish, purple marking near left eye, refined anime character design',
    negativePrompt:
      'low quality, worst quality, blurry, bad anatomy, bad hands, extra fingers, missing fingers, fused fingers, extra limbs, deformed body, ugly face, asymmetrical eyes, cropped, out of frame, duplicate, multiple girls, extra person, realistic, 3d, text, watermark, logo, horns, antlers, deer antlers, oni horns, dragon horns, animal horns, horn ornaments, antler-like ornaments'
  }
};

function normalizePresetKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function emptyPresetResolution() {
  return {
    prompt: '',
    presetName: '',
    negativePrompt: ''
  };
}

function buildPresetResolution(presetName, extraPrompt = '') {
  const preset = PROMPT_PRESETS[presetName];

  if (!preset?.prompt) {
    return emptyPresetResolution();
  }

  return {
    prompt: [preset.prompt, String(extraPrompt || '').trim()].filter(Boolean).join(', '),
    presetName,
    negativePrompt: preset.negativePrompt || ''
  };
}

export function resolvePromptPreset(rawPrompt) {
  const prompt = String(rawPrompt || '').trim();

  if (!prompt) {
    return emptyPresetResolution();
  }

  const exactPresetName = normalizePresetKey(prompt);
  const exactPreset = PROMPT_PRESETS[exactPresetName];

  if (exactPreset?.prompt) {
    return buildPresetResolution(exactPresetName);
  }

  const match = prompt.match(/^([a-z0-9_-]+)\s*[:,]\s*(.+)$/i);

  if (!match) {
    return {
      prompt,
      presetName: '',
      negativePrompt: ''
    };
  }

  const [, presetRaw, extraPromptRaw] = match;
  const presetName = normalizePresetKey(presetRaw);
  const preset = PROMPT_PRESETS[presetName];

  if (!preset?.prompt) {
    return {
      prompt,
      presetName: '',
      negativePrompt: ''
    };
  }

  return buildPresetResolution(presetName, extraPromptRaw);
}
