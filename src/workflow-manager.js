import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workflowDir = path.resolve(__dirname, '../workflows');

export const STYLE_PRESETS = {
  anime: {
    workflowFile: 'anime-sdxl-api.json',
    prefix: 'masterpiece, best quality, anime illustration',
    width: 1024,
    height: 1024,
    steps: 28,
    cfg: 6.5
  },
  portrait: {
    workflowFile: 'anime-sdxl-api.json',
    prefix: 'masterpiece, best quality, anime illustration, portrait',
    width: 832,
    height: 1216,
    steps: 28,
    cfg: 6.5
  },
  chibi: {
    workflowFile: 'anime-sdxl-api.json',
    prefix: 'masterpiece, best quality, cute chibi anime illustration, full body',
    width: 1024,
    height: 1024,
    steps: 26,
    cfg: 6.0
  },
  wallpaper: {
    workflowFile: 'anime-sdxl-api.json',
    prefix: 'masterpiece, best quality, anime illustration, cinematic background, detailed scenery, wallpaper composition',
    width: 1344,
    height: 768,
    steps: 30,
    cfg: 6.5
  }
};

export const STYLE_CHOICES = Object.keys(STYLE_PRESETS);
export const MODEL_CHOICES = config.comfyuiModelPresets.map((preset) => preset.name);

const workflowCache = new Map();

async function loadWorkflowFile(fileName) {
  if (workflowCache.has(fileName)) {
    return workflowCache.get(fileName);
  }

  const filePath = path.join(workflowDir, fileName);
  const raw = await fs.readFile(filePath, 'utf8');
  const json = JSON.parse(raw);
  workflowCache.set(fileName, json);
  return json;
}

function findNodeByTitle(workflow, title) {
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (node?._meta?.title === title) {
      return { nodeId, node };
    }
  }
  return null;
}

function setNodeInput(workflow, title, inputKey, value, { required = true } = {}) {
  const found = findNodeByTitle(workflow, title);

  if (!found) {
    if (required) {
      throw new Error(`Workflow node not found: ${title}`);
    }
    return;
  }

  found.node.inputs[inputKey] = value;
}

function resolveCheckpointName(model) {
  const matchedPreset = config.comfyuiModelPresets.find((preset) => preset.name === model);

  if (matchedPreset?.checkpoint) {
    return matchedPreset.checkpoint;
  }

  return config.comfyuiCheckpointName;
}

export async function buildWorkflow({ style, prompt, negativePrompt, seed, model }) {
  const preset = STYLE_PRESETS[style] || STYLE_PRESETS.anime;
  const baseWorkflow = await loadWorkflowFile(preset.workflowFile);
  const workflow = structuredClone(baseWorkflow);
  const checkpointName = resolveCheckpointName(model);

  const positiveText = [preset.prefix, prompt].filter(Boolean).join(', ');

  setNodeInput(workflow, 'GW_POSITIVE', 'text', positiveText);
  setNodeInput(workflow, 'GW_NEGATIVE', 'text', negativePrompt);
  setNodeInput(workflow, 'GW_KSAMPLER', 'seed', seed);
  setNodeInput(workflow, 'GW_KSAMPLER', 'steps', preset.steps);
  setNodeInput(workflow, 'GW_KSAMPLER', 'cfg', preset.cfg);
  setNodeInput(workflow, 'GW_LATENT', 'width', preset.width);
  setNodeInput(workflow, 'GW_LATENT', 'height', preset.height);
  setNodeInput(workflow, 'GW_SAVE', 'filename_prefix', `discord_${style}`);

  if (checkpointName) {
    setNodeInput(
      workflow,
      'GW_CHECKPOINT',
      'ckpt_name',
      checkpointName,
      { required: false }
    );
  }

  return workflow;
}
