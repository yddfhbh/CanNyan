import net from 'node:net';
import { randomInt } from 'node:crypto';
import path from 'node:path';
import {
  AttachmentBuilder,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags
} from 'discord.js';
import { config } from './config.js';
import { resolvePromptPreset } from './prompt-presets.js';
import { runWd14Tagger } from './tagger.js';
import { resolveModelSelection, resolveWorkflowChoice } from './workflow-manager.js';
import { TaskQueue } from './queue.js';
import { generateImage } from './comfyui.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const imageQueue = new TaskQueue({
  concurrency: config.queueConcurrency,
  maxQueue: config.maxQueue
});

const SINGLE_INSTANCE_PORT = 47881;
const lastRequestByUser = new Map();
const STYLE_COLORS = {
  anime: 0xff7a59,
  portrait: 0x4f8cff,
  fullbody: 0xffb347,
  chibi: 0x7ddc6f,
  wallpaper: 0xf7c948
};
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const TAGGER_MESSAGE_LIMIT = 1900;
const TAGGER_PROMPT_PREFIX = 'masterpiece, best quality, ultra detailed, anime illustration';
const TAGGER_NEGATIVE_PROMPT =
  'low quality, worst quality, blurry, bad anatomy, bad hands, extra fingers, missing fingers, fused fingers, extra limbs, deformed face, text, watermark, logo';
const TAGGER_MODE_SHORT = 'short';
const TAGGER_MODE_FULL = 'full';
const TAGGER_MODE_PROMPT = 'prompt';

function makeSeed() {
  return randomInt(0, 2147483647);
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isExplicitContentError(error) {
  const text = formatError(error).toLowerCase();
  return text.includes('explicit content cannot be sent');
}

function isInteractionLifecycleError(error) {
  const text = formatError(error).toLowerCase();
  return (
    error?.code === 10062 ||
    error?.code === 40060 ||
    text.includes('unknown interaction') ||
    text.includes('already been acknowledged')
  );
}

function truncate(text, max = 180) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function truncateForDiscord(text, max = TAGGER_MESSAGE_LIMIT) {
  const value = String(text || '').trim();
  if (!value) {
    return '';
  }

  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, Math.max(0, max - 16)).trimEnd()}\n...(truncated)`;
}

function formatScore(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : String(value);
}

function formatTagList(items, limit = 999) {
  const list = Array.isArray(items) ? items.slice(0, limit) : [];
  return list.length > 0
    ? list.map((item) => `${item.tag} ${formatScore(item.score)}`).join('\n')
    : '(없음)';
}

function getAttachmentFilename(attachment) {
  if (attachment?.name) {
    return attachment.name;
  }

  try {
    return path.basename(new URL(String(attachment?.url || '')).pathname) || 'image';
  } catch {
    return 'image';
  }
}

function isSupportedImageAttachment(attachment) {
  const contentType = String(attachment?.contentType || '').toLowerCase();

  if (contentType.startsWith('image/')) {
    return true;
  }

  const ext = path.extname(getAttachmentFilename(attachment)).toLowerCase();
  return SUPPORTED_IMAGE_EXTENSIONS.has(ext);
}

async function downloadAttachmentBuffer(attachment) {
  const response = await fetch(attachment.url);

  if (!response.ok) {
    throw new Error(`이미지 다운로드 실패: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function buildTaggerRecommendation(result) {
  const prompt = [TAGGER_PROMPT_PREFIX, result.prompt_tags].filter(Boolean).join(', ');
  const negative = TAGGER_NEGATIVE_PROMPT;
  const model = config.defaultModelName || 'miaomiao';
  const command = `/illust prompt: ${prompt} model:${model} style:portrait negative: ${negative}`;

  return { prompt, negative, command };
}

function buildRatingWarning(result) {
  const topRating = Array.isArray(result.rating) ? result.rating[0] : null;

  if (!topRating) {
    return '';
  }

  if (
    (topRating.tag === 'explicit' || topRating.tag === 'questionable') &&
    Number(topRating.score) >= 0.5
  ) {
    return `감지된 rating: ${topRating.tag}\n채널 설정과 서버 규칙을 확인해줘.`;
  }

  return '';
}

function buildTaggerMessage(mode, result) {
  const warning = buildRatingWarning(result);
  const recommendation = buildTaggerRecommendation(result);
  const sections = [];

  if (warning) {
    sections.push(warning);
  }

  if (mode === TAGGER_MODE_FULL) {
    sections.push(
      'WD14 태그 추출 완료',
      '',
      '[Rating]',
      formatTagList(result.rating, 10),
      '',
      '[Character]',
      formatTagList(result.character, 25),
      '',
      '[General]',
      formatTagList(result.general, 80)
    );

    if (result.raw_tags) {
      sections.push('', '[Raw Tags]', result.raw_tags);
    }
  } else if (mode === TAGGER_MODE_PROMPT) {
    sections.push(
      'WD14 태그 추출 완료',
      '',
      '[CanNyan Prompt]',
      recommendation.prompt || '(없음)',
      '',
      '[Negative]',
      recommendation.negative,
      '',
      '[추천 /illust]',
      recommendation.command
    );
  } else {
    sections.push(
      'WD14 태그 추출 완료',
      '',
      '[Prompt Tags]',
      result.prompt_tags || '(없음)',
      '',
      '[추천 /illust]',
      recommendation.command
    );
  }

  return truncateForDiscord(sections.join('\n'));
}

function buildNegativePrompt(presetNegative, extraNegative) {
  return [presetNegative || config.defaultNegativePrompt, extraNegative]
    .filter(Boolean)
    .join(', ');
}

function buildQueueMeta(interaction, request) {
  return {
    userId: interaction.user.id,
    prompt: request.prompt,
    promptPreset: request.promptPreset,
    style: request.style,
    workflow: request.workflow,
    model: request.model,
    seed: request.seed
  };
}

function formatQueueItem(item, index) {
  const presetText = item.meta.promptPreset ? ` / preset:${item.meta.promptPreset}` : '';
  return `${index + 1}. <@${item.meta.userId}> [${item.meta.style} / ${item.meta.workflow} / ${item.meta.model}${presetText}] seed ${item.meta.seed} - ${truncate(item.meta.prompt, 72)}`;
}

function buildResultEmbed(request, filename, isReroll) {
  const embed = new EmbedBuilder()
    .setColor(STYLE_COLORS[request.style] || 0x5865f2)
    .setTitle(isReroll ? '이미지 리롤 완료' : '이미지 생성 완료')
    .addFields(
      { name: 'Style', value: request.style, inline: true },
      { name: 'Workflow', value: request.workflow, inline: true },
      { name: 'Model', value: request.model, inline: true },
      { name: 'Seed', value: String(request.seed), inline: true }
    )
    .setImage(`attachment://${filename}`)
    .setTimestamp();

  if (request.promptPreset) {
    embed.addFields({ name: 'Preset', value: request.promptPreset, inline: true });
  }

  return embed;
}

async function runGeneration(interaction, request, { isReroll = false } = {}) {
  const negativePrompt = buildNegativePrompt(
    request.presetNegative,
    request.extraNegative
  );

  await interaction.deferReply();

  let queued;
  try {
    queued = imageQueue.submit(async () => {
      await interaction.editReply({
        content: [
          isReroll ? '리롤 시작' : '생성 시작',
          `style: ${request.style}`,
          `workflow: ${request.workflow}`,
          `model: ${request.model}`,
          request.promptPreset ? `preset: ${request.promptPreset}` : null,
          `seed: ${request.seed}`,
          `prompt: ${truncate(request.prompt)}`
        ].filter(Boolean).join('\n')
      });

      return generateImage({
        style: request.style,
        prompt: request.prompt,
        negativePrompt,
        seed: request.seed,
        model: request.model
      });
    }, buildQueueMeta(interaction, request));
  } catch (error) {
    await interaction.editReply({
      content: `실패: ${formatError(error)}`
    });
    return;
  }

  const { position, promise } = queued;

  if (position > 1) {
    await interaction.editReply({
      content: [
        isReroll ? '리롤 요청이 대기열에 추가됨' : '생성 요청이 대기열에 추가됨',
        `앞에 ${position - 1}개 작업이 있어.`,
        `style: ${request.style}`,
        `workflow: ${request.workflow}`,
        `model: ${request.model}`,
        request.promptPreset ? `preset: ${request.promptPreset}` : null,
        `seed: ${request.seed}`,
        `prompt: ${truncate(request.prompt)}`
      ].filter(Boolean).join('\n')
    });
  }

  let result;
  try {
    result = await promise;

    const attachment = new AttachmentBuilder(result.buffer, {
      name: result.filename
    });

    await interaction.editReply({
      content: '',
      embeds: [buildResultEmbed(request, result.filename, isReroll)],
      files: [attachment]
    });
  } catch (error) {
    if (isExplicitContentError(error)) {
      await interaction.editReply({
        content: [
          '이미지 생성은 완료됐지만 디스코드가 민감 콘텐츠로 판단해서 업로드를 막았어.',
          `model: ${request.model}`,
          `seed: ${request.seed}`,
          `파일명: ${result?.filename || '생성 완료 이미지'}`
        ].join('\n'),
        embeds: [],
        files: []
      });
      return;
    }

    await interaction.editReply({
      content: `생성 실패: ${formatError(error)}`
    });
  }
}

async function handleIllust(interaction) {
  const rawPrompt = interaction.options.getString('prompt', true).trim();
  const resolvedPrompt = resolvePromptPreset(rawPrompt);
  const selectedModel = resolveModelSelection(
    interaction.options.getString('model') || config.defaultModelName || ''
  ).modelName;
  const request = {
    prompt: resolvedPrompt.prompt,
    promptPreset: resolvedPrompt.presetName,
    presetNegative: resolvedPrompt.negativePrompt,
    style: interaction.options.getString('style') || 'anime',
    workflow: resolveWorkflowChoice({ model: selectedModel }),
    model: selectedModel,
    seed: interaction.options.getInteger('seed') ?? makeSeed(),
    extraNegative: interaction.options.getString('negative')?.trim() || ''
  };

  lastRequestByUser.set(interaction.user.id, {
    prompt: request.prompt,
    promptPreset: request.promptPreset,
    presetNegative: request.presetNegative,
    style: request.style,
    workflow: request.workflow,
    model: request.model,
    extraNegative: request.extraNegative
  });

  await runGeneration(interaction, request);
}

async function handleReroll(interaction) {
  const previous = lastRequestByUser.get(interaction.user.id);

  if (!previous) {
    await interaction.reply({
      content: '리롤할 이전 생성 기록이 없어. 먼저 `/illust`로 한 번 생성해줘.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const selectedModel = resolveModelSelection(previous.model).modelName;
  const request = {
    prompt: previous.prompt,
    promptPreset: previous.promptPreset || '',
    presetNegative: previous.presetNegative || '',
    style: previous.style,
    workflow: resolveWorkflowChoice({ model: selectedModel }),
    model: selectedModel,
    extraNegative: previous.extraNegative,
    seed: makeSeed()
  };

  lastRequestByUser.set(interaction.user.id, {
    prompt: request.prompt,
    promptPreset: request.promptPreset,
    presetNegative: request.presetNegative,
    style: request.style,
    workflow: request.workflow,
    model: request.model,
    extraNegative: request.extraNegative
  });

  await runGeneration(interaction, request, { isReroll: true });
}

async function handleStatus(interaction) {
  const snapshot = imageQueue.getSnapshot();
  const runningText = snapshot.runningItems.length > 0
    ? snapshot.runningItems.map(formatQueueItem).join('\n')
    : '없음';
  const pendingText = snapshot.pendingItems.length > 0
    ? snapshot.pendingItems.map(formatQueueItem).join('\n')
    : '없음';

  await interaction.reply({
    content: [
      '현재 이미지 큐 상태',
      `running: ${snapshot.running}`,
      `pending: ${snapshot.pending}`,
      `concurrency: ${snapshot.concurrency}`,
      `max pending: ${snapshot.maxQueue}`,
      '',
      '[실행 중]',
      runningText,
      '',
      '[대기 중]',
      pendingText
    ].join('\n'),
    flags: MessageFlags.Ephemeral
  });
}

async function handleTagger(interaction) {
  await interaction.deferReply();

  const attachment = interaction.options.getAttachment('image', true);
  const mode = interaction.options.getString('mode') || TAGGER_MODE_SHORT;
  const generalThreshold = interaction.options.getNumber('general_threshold');
  const characterThreshold = interaction.options.getNumber('character_threshold');

  if (!attachment?.url) {
    await interaction.editReply({
      content: '분석할 이미지 attachment를 찾지 못했어.'
    });
    return;
  }

  if (!isSupportedImageAttachment(attachment)) {
    await interaction.editReply({
      content: '지원되는 이미지 파일만 분석할 수 있어. png, jpg, jpeg, webp 파일을 넣어줘.'
    });
    return;
  }

  const imageBuffer = await downloadAttachmentBuffer(attachment);
  const result = await runWd14Tagger({
    imageBuffer,
    filename: getAttachmentFilename(attachment),
    mode,
    generalThreshold,
    characterThreshold
  });

  await interaction.editReply({
    content: buildTaggerMessage(mode, result)
  });
}

function acquireSingleInstanceLock() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();

    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error('Another ilust-bot instance is already running.'));
        return;
      }

      reject(error);
    });

    server.listen(SINGLE_INSTANCE_PORT, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag} (pid ${process.pid})`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    if (interaction.commandName === 'illust') {
      await handleIllust(interaction);
      return;
    }

    if (interaction.commandName === 'imgstatus') {
      await handleStatus(interaction);
      return;
    }

    if (interaction.commandName === 'reroll') {
      await handleReroll(interaction);
      return;
    }

    if (interaction.commandName === 'tagger') {
      await handleTagger(interaction);
      return;
    }
  } catch (error) {
    console.error('Interaction handling error:');
    console.error(error);

    if (isInteractionLifecycleError(error)) {
      console.error('Interaction could not be recovered because it was already expired or acknowledged.');
      return;
    }

    const message = `오류: ${formatError(error)}`;

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: message });
      } else {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
      }
    } catch (replyError) {
      console.error('Failed to send error reply:');
      console.error(replyError);
    }
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

try {
  await acquireSingleInstanceLock();
} catch (error) {
  console.error(formatError(error));
  process.exit(1);
}

client.login(config.discordToken);
