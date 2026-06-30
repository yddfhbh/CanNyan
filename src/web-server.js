import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { config } from './config.js';
import { generateImage } from './comfyui.js';
import { resolvePromptPreset } from './prompt-presets.js';
import { runWd14Tagger } from './tagger.js';
import { MODEL_CHOICES, STYLE_CHOICES, resolveModelSelection } from './workflow-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024
  }
});

const DEFAULT_TAGGER_PROMPT_PREFIX = 'masterpiece, best quality, ultra detailed, anime illustration';

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function clampSeed(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 2147483647) {
    return null;
  }

  return n;
}

function isSupportedImageFile(file) {
  const contentType = String(file?.mimetype || '').toLowerCase();
  if (contentType.startsWith('image/')) {
    return true;
  }

  const ext = path.extname(String(file?.originalname || '')).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
}

function buildWebNegativePrompt(presetNegative, extraNegative) {
  return [presetNegative || config.defaultNegativePrompt, String(extraNegative || '').trim()]
    .filter(Boolean)
    .join(', ');
}

function buildPromptTagsSummary(promptTags) {
  const text = String(promptTags || '').trim();
  if (!text) {
    return '';
  }

  return text
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 80)
    .join(', ');
}

function buildTaggerResponse(result) {
  return {
    ok: true,
    promptTags: buildPromptTagsSummary(result.prompt_tags),
    rawTags: String(result.raw_tags || ''),
    rating: Array.isArray(result.rating) ? result.rating : [],
    general: Array.isArray(result.general) ? result.general : [],
    character: Array.isArray(result.character) ? result.character : []
  };
}

function inferMimeType(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();

  if (ext === '.jpg' || ext === '.jpeg') {
    return 'image/jpeg';
  }

  if (ext === '.webp') {
    return 'image/webp';
  }

  return 'image/png';
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(publicDir));

app.get('/api/meta', (_req, res) => {
  res.json({
    ok: true,
    defaultModel: config.defaultModelName || '',
    defaultStyle: 'anime',
    defaultNegative: config.defaultNegativePrompt,
    modelChoices: MODEL_CHOICES,
    styleChoices: STYLE_CHOICES
  });
});

app.post('/api/tagger', upload.single('image'), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      res.status(400).json({
        ok: false,
        error: '이미지 파일을 올려줘.'
      });
      return;
    }

    if (!isSupportedImageFile(file)) {
      res.status(400).json({
        ok: false,
        error: '이미지 파일만 분석할 수 있어. png, jpg, jpeg, webp 파일을 사용해줘.'
      });
      return;
    }

    const generalThreshold = req.body?.generalThreshold === undefined
      ? undefined
      : Number(req.body.generalThreshold);
    const characterThreshold = req.body?.characterThreshold === undefined
      ? undefined
      : Number(req.body.characterThreshold);

    const result = await runWd14Tagger({
      imageBuffer: file.buffer,
      filename: file.originalname,
      mode: 'prompt',
      generalThreshold,
      characterThreshold
    });

    res.json(buildTaggerResponse(result));
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: `WD14 태그 추출 실패: ${formatError(error)}`
    });
  }
});

app.post('/api/generate', async (req, res) => {
  try {
    const rawPrompt = String(req.body?.prompt || '').trim();

    if (!rawPrompt) {
      res.status(400).json({
        ok: false,
        error: '프롬프트를 입력해줘.'
      });
      return;
    }

    const resolvedPrompt = resolvePromptPreset(rawPrompt);
    const selectedModel = resolveModelSelection(
      String(req.body?.model || config.defaultModelName || '').trim()
    ).modelName;
    const style = STYLE_CHOICES.includes(String(req.body?.style || ''))
      ? String(req.body.style)
      : 'anime';
    const negativePrompt = buildWebNegativePrompt(
      resolvedPrompt.negativePrompt,
      req.body?.negative
    );
    const seed = clampSeed(req.body?.seed);

    const result = await generateImage({
      style,
      prompt: resolvedPrompt.prompt || rawPrompt,
      negativePrompt,
      seed: seed ?? Math.floor(Math.random() * 2147483647),
      model: selectedModel
    });

    res.json({
      ok: true,
      filename: result.filename,
      prompt: resolvedPrompt.prompt || rawPrompt,
      negativePrompt,
      promptPreset: resolvedPrompt.presetName || '',
      model: selectedModel,
      style,
      imageBase64: result.buffer.toString('base64'),
      mimeType: inferMimeType(result.filename)
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: `이미지 생성 실패: ${formatError(error)}`
    });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({
      ok: false,
      error: `업로드 오류: ${error.message}`
    });
    return;
  }

  res.status(500).json({
    ok: false,
    error: formatError(error)
  });
});

app.listen(config.webPort, () => {
  console.log(`CanNyan web UI listening on http://127.0.0.1:${config.webPort}`);
  console.log(`Default prompt prefix: ${DEFAULT_TAGGER_PROMPT_PREFIX}`);
});
