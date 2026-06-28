import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workflowDir = path.resolve(__dirname, '../workflows');

const DEFAULT_WORKFLOW_FILE = 'anime-sdxl-api.json';
const ANIMA_WORKFLOW_FILE = 'anima-api.json';
const DEFAULT_WORKFLOW_KEY = 'anime-sdxl';
const ANIMA_WORKFLOW_KEY = 'anima';

const WORKFLOW_FILES = {
  [DEFAULT_WORKFLOW_KEY]: DEFAULT_WORKFLOW_FILE,
  [ANIMA_WORKFLOW_KEY]: ANIMA_WORKFLOW_FILE
};

export const STYLE_PRESETS = {
  anime: {
    prefix: 'masterpiece, best quality, anime illustration',
    negativePrefix: '',
    width: 1024,
    height: 1024,
    steps: 28,
    cfg: 6.5
  },

  portrait: {
    prefix: 'masterpiece, best quality, anime illustration, portrait, upper body, face focus',
    negativePrefix: '',
    width: 832,
    height: 1216,
    steps: 28,
    cfg: 6.5
  },

  fullbody: {
    prefix: 'masterpiece, best quality, anime illustration, full body, full-length, from head to toe, feet visible, entire figure in frame, standing, centered composition, long shot',
    negativePrefix: 'close-up, upper body, bust shot, cowboy shot, giant face, superimposed face, tiny full body, miniature person, cut off feet, cropped legs, out of frame',
    width: 896,
    height: 1344,
    steps: 30,
    cfg: 6.5
  },

  chibi: {
    prefix: 'masterpiece, best quality, cute chibi anime illustration, full body',
    negativePrefix: '',
    width: 1024,
    height: 1024,
    steps: 26,
    cfg: 6.0
  },

  wallpaper: {
    prefix: 'masterpiece, best quality, anime illustration, cinematic background, detailed scenery, wallpaper composition',
    negativePrefix: '',
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

function connectNodeInput(workflow, title, inputKey, sourceTitle, outputIndex, { required = true } = {}) {
  const target = findNodeByTitle(workflow, title);
  const source = findNodeByTitle(workflow, sourceTitle);

  if (!target || !source) {
    if (required) {
      throw new Error(`Workflow connection not found: ${sourceTitle} -> ${title}.${inputKey}`);
    }
    return;
  }

  target.node.inputs[inputKey] = [source.nodeId, outputIndex];
}

function resolveModelPreset(model) {
  return config.comfyuiModelPresets.find((preset) => preset.name === model) || null;
}

export function resolveModelSelection(model) {
  const normalizedModel = String(model || '').trim();

  if (!normalizedModel) {
    if (config.defaultModelName) {
      const matchedDefault = resolveModelPreset(config.defaultModelName);

      if (matchedDefault?.checkpoint) {
        return {
          modelName: matchedDefault.name,
          checkpointName: matchedDefault.checkpoint
        };
      }
    }

    if (config.comfyuiCheckpointName) {
      return {
        modelName: 'default',
        checkpointName: config.comfyuiCheckpointName
      };
    }

    throw new Error('No default model checkpoint is configured.');
  }

  const matchedPreset = resolveModelPreset(normalizedModel);

  if (matchedPreset?.checkpoint) {
    return {
      modelName: matchedPreset.name,
      checkpointName: matchedPreset.checkpoint
    };
  }

  throw new Error(`Unknown model preset: ${normalizedModel}`);
}

function isAnimaModel(model, checkpointName) {
  const text = `${model || ''} ${checkpointName || ''}`.toLowerCase();

  return (
    text.includes('miaomiao') ||
    text.includes('qwen')
  );
}

function resolveWorkflowKey({ model, checkpointName }) {
  if (isAnimaModel(model, checkpointName)) {
    return ANIMA_WORKFLOW_KEY;
  }

  return DEFAULT_WORKFLOW_KEY;
}

export function resolveWorkflowChoice({ model }) {
  const selection = resolveModelSelection(model);
  return resolveWorkflowKey({
    model: selection.modelName,
    checkpointName: selection.checkpointName
  });
}

export async function buildWorkflow({ style, prompt, negativePrompt, seed, model }) {
  const preset = STYLE_PRESETS[style] || STYLE_PRESETS.anime;
  const selection = resolveModelSelection(model);
  const modelName = selection.modelName;
  const checkpointName = selection.checkpointName;
  const workflowKey = resolveWorkflowChoice({ model: modelName });
  const workflowFile = WORKFLOW_FILES[workflowKey] || DEFAULT_WORKFLOW_FILE;

  const baseWorkflow = await loadWorkflowFile(workflowFile);
  const workflow = structuredClone(baseWorkflow);

  const positiveText = [preset.prefix, prompt].filter(Boolean).join(', ');
  const mergedNegativePrompt = [preset.negativePrefix, negativePrompt]
    .filter(Boolean)
    .join(', ');

  setNodeInput(workflow, 'GW_POSITIVE', 'text', positiveText);
  setNodeInput(workflow, 'GW_NEGATIVE', 'text', mergedNegativePrompt);

  setNodeInput(workflow, 'GW_KSAMPLER', 'seed', seed);
  setNodeInput(workflow, 'GW_KSAMPLER', 'steps', preset.steps);
  setNodeInput(workflow, 'GW_KSAMPLER', 'cfg', preset.cfg);

  setNodeInput(workflow, 'GW_LATENT', 'width', preset.width);
  setNodeInput(workflow, 'GW_LATENT', 'height', preset.height);

  if (workflowKey === ANIMA_WORKFLOW_KEY) {
    connectNodeInput(workflow, 'GW_POSITIVE', 'clip', 'GW_CLIP', 0);
    connectNodeInput(workflow, 'GW_NEGATIVE', 'clip', 'GW_CLIP', 0);
    connectNodeInput(workflow, 'GW_VAE_DECODE', 'vae', 'GW_VAE', 0);
  }

  setNodeInput(
    workflow,
    'GW_SAVE',
    'filename_prefix',
    `discord_${workflowKey}_${modelName}_${style}`
  );

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
