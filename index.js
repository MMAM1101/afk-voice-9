require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const { execSync, spawn } = require('child_process');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PREFIX = process.env.PREFIX || '!';
let connection = null;
let player = createAudioPlayer();

// ─── Voice Join ───────────────────────────────────────────────────────────────
async function joinChannel(guild, channelId) {
  const channel = guild.channels.cache.get(channelId);
  if (!channel) { console.error(`Channel ${channelId} not found`); return; }

  if (connection) connection.destroy();

  connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
  });

  connection.subscribe(player);

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      console.log('Disconnected — reconnecting in 5s...');
      connection.destroy();
      connection = null;
      setTimeout(() => joinChannel(guild, channelId), 5_000);
    }
  });

  connection.on(VoiceConnectionStatus.Ready, () => {
    console.log(`[BOT ${process.env.BOT_NUMBER || '?'}] Connected to voice`);
  });
}

// ─── Get YouTube direct URL (tries android → mweb → web) ─────────────────────
function getYouTubeUrl(youtubeUrl) {
  const clients = ['android', 'mweb', 'web'];
  for (const ytclient of clients) {
    try {
      const cmd =
        `python3 -m yt_dlp -f "bestaudio[ext=webm]/bestaudio/best" ` +
        `--get-url --no-playlist --no-update ` +
        `--extractor-args "youtube:player_client=${ytclient}" ` +
        `"${youtubeUrl}"`;
      const url = execSync(cmd, { timeout: 30000 }).toString().trim().split('\n')[0];
      if (url && url.startsWith('http')) {
        console.log(`Got URL via client: ${ytclient}`);
        return url;
      }
    } catch (e) {
      console.log(`Client ${ytclient} failed, trying next...`);
    }
  }
  throw new Error('فشل تحميل الرابط — جرب رابط ثاني');
}

// ─── Stream via ffmpeg ────────────────────────────────────────────────────────
function streamUrl(directUrl) {
  const ffmpeg = spawn('ffmpeg', [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i', directUrl,
    '-analyzeduration', '0',
    '-loglevel', 'error',
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'ignore'] });

  return createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
}

// ─── Bot Ready ────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`[BOT ${process.env.BOT_NUMBER || '?'}] ${client.user.tag} ready`);
  const guildId   = process.env.GUILD_ID;
  const channelId = process.env.VOICE_CHANNEL_ID;
  if (guildId && channelId) {
    const guild = client.guilds.cache.get(guildId);
    if (guild) await joinChannel(guild, channelId);
    else console.error(`Guild ${guildId} not found`);
  } else {
    console.log('No GUILD_ID/VOICE_CHANNEL_ID — use !join to connect');
  }
});

// ─── Commands ─────────────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args    = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'join') {
    if (!message.member.voice.channel)
      return message.reply('❌ أنت مو في فويس!');
    await joinChannel(message.guild, message.member.voice.channel.id);
    return message.reply(`✅ انضممت لـ **${message.member.voice.channel.name}**`);
  }

  if (command === 'play') {
    const url = args[0];
    if (!url)
      return message.reply('❌ أرسل رابط يوتيوب\nمثال: `!play https://youtu.be/...`');
    if (!connection)
      return message.reply('❌ البوت مو في فويس — استخدم `!join` أول');

    const loading = await message.reply('⏳ يحمل...');
    try {
      const directUrl = getYouTubeUrl(url);
      const resource  = streamUrl(directUrl);
      player.play(resource);
      await loading.edit('🎵 يشغل!');
    } catch (err) {
      console.error('Play error:', err.message);
      await loading.edit(`❌ ${err.message}`);
    }
    return;
  }

  if (command === 'stop') {
    player.stop();
    return message.reply('⏹ وقفت التشغيل');
  }

  if (command === 'leave') {
    if (connection) { connection.destroy(); connection = null; }
    return message.reply('👋 طلعت من الفويس');
  }

  if (command === 'ping') {
    return message.reply(`🏓 Pong! \`${client.ws.ping}ms\``);
  }
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  if (connection) connection.destroy();
  client.destroy();
  process.exit(0);
});
process.on('SIGINT', () => {
  if (connection) connection.destroy();
  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
