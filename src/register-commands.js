import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from './config.js';
import { MODEL_CHOICES, STYLE_CHOICES } from './workflow-manager.js';

const commands = [
  new SlashCommandBuilder()
    .setName('illust')
    .setDescription('로컬 ComfyUI로 일러스트를 생성합니다.')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('생성 프롬프트')
        .setRequired(true)
        .setMaxLength(4000)
    )
    .addStringOption((option) => {
      option
        .setName('style')
        .setDescription('스타일 프리셋')
        .setRequired(false);

      for (const style of STYLE_CHOICES) {
        option.addChoices({ name: style, value: style });
      }

      return option;
    })
    .addStringOption((option) => {
      option
        .setName('model')
        .setDescription('사용할 체크포인트 모델')
        .setRequired(false);

      for (const model of MODEL_CHOICES) {
        option.addChoices({ name: model, value: model });
      }

      return option;
    })
    .addIntegerOption((option) =>
      option
        .setName('seed')
        .setDescription('시드값 (비워두면 랜덤)')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(2147483647)
    )
    .addStringOption((option) =>
      option
        .setName('negative')
        .setDescription('추가 네거티브 프롬프트')
        .setRequired(false)
        .setMaxLength(4000)
    ),

  new SlashCommandBuilder()
    .setName('imgstatus')
    .setDescription('현재 이미지 생성 큐 상태를 확인합니다.'),

  new SlashCommandBuilder()
    .setName('reroll')
    .setDescription('마지막 생성 프롬프트로 seed만 바꿔 다시 생성합니다.'),

  new SlashCommandBuilder()
    .setName('tagger')
    .setDescription('첨부 이미지를 WD14로 분석해서 프롬프트 태그를 추천합니다.')
    .addAttachmentOption((option) =>
      option
        .setName('image')
        .setDescription('분석할 이미지 파일')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('출력 형식')
        .setRequired(false)
        .addChoices(
          { name: 'short', value: 'short' },
          { name: 'full', value: 'full' },
          { name: 'prompt', value: 'prompt' }
        )
    )
    .addNumberOption((option) =>
      option
        .setName('general_threshold')
        .setDescription('일반 태그 임계값 (0~1)')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(1)
    )
    .addNumberOption((option) =>
      option
        .setName('character_threshold')
        .setDescription('캐릭터 태그 임계값 (0~1)')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(1)
    )
].map((command) => command.toJSON());

const rest = new REST({ version: '10' }).setToken(config.discordToken);

async function main() {
  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: commands }
  );

  console.log(`Registered ${commands.length} guild command(s) to guild ${config.guildId}`);
}

main().catch((error) => {
  console.error('Failed to register commands:');
  console.error(error);
  process.exit(1);
});
