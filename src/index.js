import net from 'node:net';
import { randomInt } from 'node:crypto';
import {
  AttachmentBuilder,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags
} from 'discord.js';
import { config } from './config.js';
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
const NOOBAI_SAFETY_NEGATIVE =
  'nsfw, nude, nipples, cleavage, sideboob, underboob, open clothes, unbuttoned shirt, deep neckline, exposed chest, lingerie, bra, suggestive';

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

function resolveModelSafetyNegative(model) {
  const text = String(model || '').toLowerCase();

  if (text.includes('noobai')) {
    return NOOBAI_SAFETY_NEGATIVE;
  }

  return '';
}

function buildNegativePrompt(model, extraNegative) {
  return [config.defaultNegativePrompt, resolveModelSafetyNegative(model), extraNegative]
    .filter(Boolean)
    .join(', ');
}

function buildQueueMeta(interaction, request) {
  return {
    userId: interaction.user.id,
    prompt: request.prompt,
    style: request.style,
    workflow: request.workflow,
    model: request.model,
    seed: request.seed
  };
}

function formatQueueItem(item, index) {
  return `${index + 1}. <@${item.meta.userId}> [${item.meta.style} / ${item.meta.workflow} / ${item.meta.model}] seed ${item.meta.seed} - ${truncate(item.meta.prompt, 72)}`;
}

function buildResultEmbed(request, filename, isReroll) {
  return new EmbedBuilder()
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
}

async function runGeneration(interaction, request, { isReroll = false } = {}) {
  const negativePrompt = buildNegativePrompt(request.model, request.extraNegative);

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
          `seed: ${request.seed}`,
          `prompt: ${truncate(request.prompt)}`
        ].join('\n')
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
        `seed: ${request.seed}`,
        `prompt: ${truncate(request.prompt)}`
      ].join('\n')
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
  const selectedModel = resolveModelSelection(
    interaction.options.getString('model') || config.defaultModelName || ''
  ).modelName;
  const request = {
    prompt: interaction.options.getString('prompt', true).trim(),
    style: interaction.options.getString('style') || 'anime',
    workflow: resolveWorkflowChoice({ model: selectedModel }),
    model: selectedModel,
    seed: interaction.options.getInteger('seed') ?? makeSeed(),
    extraNegative: interaction.options.getString('negative')?.trim() || ''
  };

  lastRequestByUser.set(interaction.user.id, {
    prompt: request.prompt,
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
    style: previous.style,
    workflow: resolveWorkflowChoice({ model: selectedModel }),
    model: selectedModel,
    extraNegative: previous.extraNegative,
    seed: makeSeed()
  };

  lastRequestByUser.set(interaction.user.id, {
    prompt: request.prompt,
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
