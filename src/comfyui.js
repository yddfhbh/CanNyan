import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { buildWorkflow } from './workflow-manager.js';

function buildUrl(pathname, searchParams = null) {
  const base = config.comfyuiBaseUrl.endsWith('/')
    ? config.comfyuiBaseUrl
    : `${config.comfyuiBaseUrl}/`;

  const url = new URL(pathname, base);

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(pathname, body) {
  const response = await fetch(buildUrl(pathname), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(`ComfyUI POST ${pathname} failed: ${response.status} ${response.statusText}`);
  }

  return data;
}

async function getJson(pathname) {
  const response = await fetch(buildUrl(pathname));

  if (!response.ok) {
    throw new Error(`ComfyUI GET ${pathname} failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function extractFirstImageInfo(promptHistory) {
  const outputs = promptHistory?.outputs || {};

  for (const nodeOutput of Object.values(outputs)) {
    if (Array.isArray(nodeOutput?.images) && nodeOutput.images.length > 0) {
      return nodeOutput.images[0];
    }
  }

  return null;
}

async function queuePrompt(workflow) {
  const clientId = randomUUID();

  const data = await postJson('/prompt', {
    prompt: workflow,
    client_id: clientId
  });

  if (!data?.prompt_id) {
    throw new Error('ComfyUI did not return prompt_id.');
  }

  return data.prompt_id;
}

async function waitForImage(promptId) {
  const deadline = Date.now() + config.generationTimeoutMs;

  while (Date.now() < deadline) {
    const history = await getJson(`/history/${promptId}`);
    const promptHistory = history?.[promptId];

    if (promptHistory) {
      const imageInfo = extractFirstImageInfo(promptHistory);
      if (imageInfo) {
        return imageInfo;
      }
    }

    await sleep(1000);
  }

  throw new Error('이미지 생성이 시간 초과되었어.');
}

async function downloadImageBuffer(imageInfo) {
  const response = await fetch(
    buildUrl('/view', {
      filename: imageInfo.filename,
      subfolder: imageInfo.subfolder || '',
      type: imageInfo.type || 'output'
    })
  );

  if (!response.ok) {
    throw new Error(`Failed to download image from ComfyUI: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function generateImage({ style, prompt, negativePrompt, seed, model }) {
  const builtWorkflow = await buildWorkflow({
    style,
    prompt,
    negativePrompt,
    seed,
    model
  });

  const promptId = await queuePrompt(builtWorkflow);
  const imageInfo = await waitForImage(promptId);
  const buffer = await downloadImageBuffer(imageInfo);

  const filename = imageInfo.filename || `generated_${seed}.png`;

  return {
    buffer,
    filename,
    promptId
  };
}
