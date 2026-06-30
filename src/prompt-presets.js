export const PROMPT_PRESETS = {
  kanna: {
    prompt:
      '1girl, solo, adult woman, delicate face, blue-violet eyes, soft blush, playful teasing expression, long brown hair, very long hair, high twin tails, layered bangs, blue and purple gradient inner hair, vivid blue-purple hair streaks, silky glossy hair, fluffy black cat ears, cat ears only, long slender cat tail, thin cat tail, sleek cat tail, smooth fur tail, elegant tail, tail with blue-purple gradient tip, multiple earrings, blue nail polish, refined anime character design',
    negativePrompt:
      'low quality, worst quality, blurry, bad anatomy, bad hands, extra fingers, missing fingers, fused fingers, extra limbs, deformed body, ugly face, asymmetrical eyes, cropped, out of frame, duplicate, multiple girls, extra person, realistic, 3d, text, watermark, logo, horns, antlers, deer antlers, oni horns, dragon horns, animal horns, horn ornaments, antler-like ornaments, fluffy tail, bushy tail, fox tail, wolf tail, face markings, cheek markings, facial markings, tattoos on face, face tattoo, war paint, stripes on cheeks, whisker marks, colored cheek mark'
  },
  hebi: {
    prompt:
      '1girl, solo, adult woman, cute delicate face, soft gentle smile, calm expression, light blue eyes, blue eyes, soft blush, pale fair skin, small nose, small mouth, silver white hair, white hair, very light silver hair, high twin tails, long twin tails, blue and purple gradient hair accents, blue inner hair, purple inner hair, glossy silky hair, soft bangs, side swept bangs, small ahoge, black hairpin, x-shaped hairpin, elegant cute anime girl, slender body, petite body, small bust, A-cup bust, modest chest, refined anime character design, soft pastel color palette, clean lineart, soft smooth shading, polished anime render',
    negativePrompt:
      'low quality, worst quality, blurry, bad anatomy, bad hands, extra fingers, missing fingers, fused fingers, extra limbs, deformed body, ugly face, asymmetrical eyes, cropped, out of frame, duplicate, multiple girls, extra person, realistic, 3d, text, watermark, logo, large breasts, big breasts, huge breasts, cleavage, oversized chest, mature curvy body, thick body, muscular body, messy hair, dark hair, black hair, red eyes, harsh expression'
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

function splitPromptTokens(prompt) {
  return String(prompt || '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
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

  const tokens = splitPromptTokens(prompt);
  const presetTokenIndex = tokens.findIndex((token) => PROMPT_PRESETS[normalizePresetKey(token)]?.prompt);

  if (presetTokenIndex >= 0) {
    const presetName = normalizePresetKey(tokens[presetTokenIndex]);
    const remainingTokens = tokens.filter((_, index) => index !== presetTokenIndex);
    return buildPresetResolution(presetName, remainingTokens.join(', '));
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
