import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const taggerScriptPath = path.join(projectRoot, 'scripts', 'wd14_tagger.py');

function resolveModelDir() {
  if (path.isAbsolute(config.wd14ModelDir)) {
    return config.wd14ModelDir;
  }

  return path.resolve(projectRoot, config.wd14ModelDir);
}

function resolveThreshold(value, fallback) {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

function resolveTempExtension(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext) ? ext : '.png';
}

async function cleanupTempDir(tempDir) {
  if (!tempDir) {
    return;
  }

  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {}
}

export async function runWd14Tagger({
  imageBuffer,
  filename,
  mode,
  generalThreshold,
  characterThreshold
}) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new Error('WD14 tagger needs a non-empty image buffer.');
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cannyan-wd14-'));
  const tempImagePath = path.join(tempDir, `input${resolveTempExtension(filename)}`);

  try {
    await fs.writeFile(tempImagePath, imageBuffer);

    const resolvedGeneralThreshold = resolveThreshold(
      generalThreshold,
      config.wd14GeneralThreshold
    );
    const resolvedCharacterThreshold = resolveThreshold(
      characterThreshold,
      config.wd14CharacterThreshold
    );

    const args = [
      taggerScriptPath,
      '--image',
      tempImagePath,
      '--model-dir',
      resolveModelDir(),
      '--repo',
      config.wd14ModelRepo,
      '--general-threshold',
      String(resolvedGeneralThreshold),
      '--character-threshold',
      String(resolvedCharacterThreshold)
    ];

    const { stdout, stderr } = await execFileAsync(config.wd14PythonPath, args, {
      timeout: config.wd14TimeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    });

    if (!stdout?.trim()) {
      throw new Error(stderr?.trim() || 'WD14 tagger returned empty output.');
    }

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (error) {
      throw new Error(
        `Failed to parse WD14 output as JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return {
      mode: String(mode || 'short'),
      ...parsed
    };
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr).trim() : '';
    const detail = stderr || (error instanceof Error ? error.message : String(error));
    throw new Error(`WD14 tagger failed: ${detail}`);
  } finally {
    await cleanupTempDir(tempDir);
  }
}
