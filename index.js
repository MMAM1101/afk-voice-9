require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  VoiceConnectionStatus,
  entersState,
  AudioPlayerStatus,
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
let queue = [];

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
    console.log(`[BOT ${process.env.BOT_NUMBER || '?'}] Connected → ${channel.name}`);
  });
}

// ─── YouTube Streaming via yt-dlp + ffmpeg ────────────────────────────────────
function playYoutube(url) {
  return new Promise((resolve, reject) => {
    let directUrl;
    try {
      // Step 1: get direct audio URL from yt-dlp (no piping issues)
      directUrl = execSync(
        `yt-dlp -f "bestaudio[ext=webm]/bestaudio/best" --get-url --no-playlist "${url}"`,
        { timeout: 30000 }
      ).toString().trim().split('\n')[0];
    } catch (err) {
      return reject(new Error('yt-dlp failed: ' + err.message));
    }

    if (!directUrl) return reject(new Error('No URL returned from yt-dlp'));

    // Step 2: stream through ffmpeg → raw PCM → Discord
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

    ffmpeg.on('error', reject);

    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.Raw,
    });

    resolve(resource);
  });
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
    console.log('No GUILD_ID/VOICE_CHANNEL_ID — waiting for !join');
  }
});

// ─── Commands ─────────────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args    = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // !join
  if (command === 'join') {
    if (!message.member.voice.channel)
      return message.reply('❌ أنت مو في فويس!');
    await joinChannel(message.guild, message.member.voice.channel.id);
    return message.reply(`✅ انضممت لـ **${message.member.voice.channel.name}**`);
  }

  // !play
  if (command === 'play') {
    const url = args[0];
    if (!url) return message.reply('❌ أرسل رابط يوتيوب\nمثال: `!play https://youtube.com/watch?v=...`');
    if (!connection) return message.reply('❌ البوت مو في فويس — استخدم `!join` أول');

    const loading = await message.reply('⏳ يحمل الرابط...');
    try {
      const resource = await playYoutube(url);
      player.play(resource);
      await loading.edit('🎵 يشغل...');
    } catch (err) {
      console.error('Play error:', err.message);
      await loading.edit(`❌ خطأ: ${err.message}`);
    }
    return;
  }

  // !stop
  if (command === 'stop') {
    player.stop();
    return message.reply('⏹ وقفت التشغيل');
  }

  // !leave
  if (command === 'leave') {
    if (connection) { connection.destroy(); connection = null; }
    return message.reply('👋 طلعت من الفويس');
  }

  // !ping
  if (command === 'ping') {
    return message.reply(`🏓 Pong! \`${client.ws.ping}ms\``);
  }
});

// ─── Graceful Shutdown (Railway only) ────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('SIGTERM — shutting down gracefully');
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
