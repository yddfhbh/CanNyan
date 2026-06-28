import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workflowDir = path.resolve(__dirname, '../workflows');

const DEFAULT_WORKFLOW_FILE = 'anime-sdxl-api.json';
const ANIMA_WORKFLOW_FILE = 'anima-api.json';
const REED_ANIMA_WORKFLOW_FILE = 'reedAnima.json';
const WAI_ANIMA_WORKFLOW_FILE = 'waiAniMa.json';
const DEFAULT_WORKFLOW_KEY = 'anime-sdxl';
const ANIMA_WORKFLOW_KEY = 'anima';
const REED_ANIMA_WORKFLOW_KEY = 'reedanima';
const WAI_ANIMA_WORKFLOW_KEY = 'waianima';

const WORKFLOW_DEFINITIONS = {
  [DEFAULT_WORKFLOW_KEY]: {
    fileName: DEFAULT_WORKFLOW_FILE,
    nodeIds: {
      ksampler: '3',
      checkpoint: '4',
      latent: '5',
      positive: '6',
      negative: '7',
      vaeDecode: '8',
      save: '9'
    }
  },
  [ANIMA_WORKFLOW_KEY]: {
    fileName: ANIMA_WORKFLOW_FILE,
    nodeIds: {
      ksampler: '1',
      checkpoint: '2',
      positive: '3',
      negative: '4',
      latent: '5',
      vaeDecode: '6',
      save: '7',
      vae: '8',
      clip: '9'
    }
  },
  [REED_ANIMA_WORKFLOW_KEY]: {
    fileName: REED_ANIMA_WORKFLOW_FILE,
    nodeIds: {
      latent: '1',
      ksampler: '2',
      vaeDecode: '3',
      vae: '4',
      checkpoint: '5',
      positive: '6',
      negative: '7',
      clip: '8',
      save: '9'
    }
  },
  [WAI_ANIMA_WORKFLOW_KEY]: {
    fileName: WAI_ANIMA_WORKFLOW_FILE,
    nodeIds: {
      latent: '1',
      ksampler: '2',
      vaeDecode: '3',
      vae: '4',
      checkpoint: '5',
      positive: '6',
      negative: '7',
      clip: '8',
      save: '9'
    }
  }
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

function findNode(workflow, workflowKey, logicalNodeKey) {
  const nodeId = WORKFLOW_DEFINITIONS[workflowKey]?.nodeIds?.[logicalNodeKey];
  if (!nodeId) {
    return null;
  }

  const node = workflow[nodeId];
  if (!node) {
    return null;
  }

  return { nodeId, node };
}

function setNodeInput(workflow, workflowKey, logicalNodeKey, inputKey, value, { required = true } = {}) {
  const found = findNode(workflow, workflowKey, logicalNodeKey);

  if (!found) {
    if (required) {
      throw new Error(`Workflow node not found: ${workflowKey}.${logicalNodeKey}`);
    }
    return;
  }

  found.node.inputs[inputKey] = value;
}

function connectNodeInput(workflow, workflowKey, logicalNodeKey, inputKey, sourceLogicalNodeKey, outputIndex, { required = true } = {}) {
  const target = findNode(workflow, workflowKey, logicalNodeKey);
  const source = findNode(workflow, workflowKey, sourceLogicalNodeKey);

  if (!target || !source) {
    if (required) {
      throw new Error(`Workflow connection not found: ${workflowKey}.${sourceLogicalNodeKey} -> ${workflowKey}.${logicalNodeKey}.${inputKey}`);
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

function isReedAnimaModel(model, checkpointName) {
  const text = `${model || ''} ${checkpointName || ''}`.toLowerCase();
  return text.includes('reedanima');
}

function isWaiAnimaModel(model, checkpointName) {
  const text = `${model || ''} ${checkpointName || ''}`.toLowerCase();
  return text.includes('waianima');
}

function resolveWorkflowKey({ model, checkpointName }) {
  if (isReedAnimaModel(model, checkpointName)) {
    return REED_ANIMA_WORKFLOW_KEY;
  }

  if (isWaiAnimaModel(model, checkpointName)) {
    return WAI_ANIMA_WORKFLOW_KEY;
  }

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
  const workflowFile = WORKFLOW_DEFINITIONS[workflowKey]?.fileName || DEFAULT_WORKFLOW_FILE;

  const baseWorkflow = await loadWorkflowFile(workflowFile);
  const workflow = structuredClone(baseWorkflow);

  const positiveText = [preset.prefix, prompt].filter(Boolean).join(', ');
  const mergedNegativePrompt = [preset.negativePrefix, negativePrompt]
    .filter(Boolean)
    .join(', ');

  setNodeInput(workflow, workflowKey, 'positive', 'text', positiveText);
  setNodeInput(workflow, workflowKey, 'negative', 'text', mergedNegativePrompt);

  setNodeInput(workflow, workflowKey, 'ksampler', 'seed', seed);
  setNodeInput(workflow, workflowKey, 'ksampler', 'steps', preset.steps);
  setNodeInput(workflow, workflowKey, 'ksampler', 'cfg', preset.cfg);

  setNodeInput(workflow, workflowKey, 'latent', 'width', preset.width);
  setNodeInput(workflow, workflowKey, 'latent', 'height', preset.height);

  if (
    workflowKey === ANIMA_WORKFLOW_KEY ||
    workflowKey === REED_ANIMA_WORKFLOW_KEY ||
    workflowKey === WAI_ANIMA_WORKFLOW_KEY
  ) {
    connectNodeInput(workflow, workflowKey, 'positive', 'clip', 'clip', 0);
    connectNodeInput(workflow, workflowKey, 'negative', 'clip', 'clip', 0);
    connectNodeInput(workflow, workflowKey, 'vaeDecode', 'vae', 'vae', 0);
  }

  setNodeInput(
    workflow,
    workflowKey,
    'save',
    'filename_prefix',
    `discord_${workflowKey}_${modelName}_${style}`
  );

  if (checkpointName) {
    setNodeInput(
      workflow,
      workflowKey,
      'checkpoint',
      'ckpt_name',
      checkpointName,
      { required: false }
    );
  }

  return workflow;
}
