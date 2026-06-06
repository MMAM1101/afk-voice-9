require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const YTDlpWrap = require('yt-dlp-wrap').default;

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
let player = null;

async function joinChannel(guild, channelId) {
  const channel = guild.channels.cache.get(channelId);
  if (!channel) {
    console.error(`Channel ${channelId} not found`);
    return;
  }

  connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
  });

  player = createAudioPlayer();
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
    console.log(`Connected to voice channel: ${channel.name}`);
  });
}

client.once('ready', async () => {
  console.log(`[BOT ${process.env.BOT_NUMBER || '?'}] ${client.user.tag} is ready!`);

  const guildId = process.env.GUILD_ID;
  const channelId = process.env.VOICE_CHANNEL_ID;

  if (guildId && channelId) {
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      await joinChannel(guild, channelId);
    } else {
      console.error(`Guild ${guildId} not found — make sure bot is invited`);
    }
  } else {
    console.log('No GUILD_ID/VOICE_CHANNEL_ID set — waiting for !join command');
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'join') {
    if (!message.member.voice.channel) {
      return message.reply('❌ أنت مو في فويس!');
    }
    if (connection) connection.destroy();

    await joinChannel(message.guild, message.member.voice.channel.id);
    return message.reply(`✅ انضممت لـ ${message.member.voice.channel.name}`);
  }

  if (command === 'play') {
    const url = args[0];
    if (!url) return message.reply('❌ أرسل رابط يوتيوب مثل: `!play https://youtube.com/...`');
    if (!connection) return message.reply('❌ البوت مو في فويس — استخدم !join أول');

    try {
      await message.reply('⏳ يحمل...');
      const ytDlp = new YTDlpWrap();
      const stream = ytDlp.execStream([
        url,
        '-f', 'bestaudio[ext=webm]/bestaudio',
        '-o', '-',
        '--no-playlist',
        '--quiet',
      ]);

      stream.on('error', (err) => {
        console.error('Stream error:', err.message);
        message.channel.send('❌ صار خطأ في تحميل الصوت');
      });

      const resource = createAudioResource(stream);
      player.play(resource);
      return message.channel.send('🎵 يشغل...');
    } catch (err) {
      console.error('Play error:', err);
      return message.reply('❌ صار خطأ في تشغيل الصوت');
    }
  }

  if (command === 'stop') {
    if (player) player.stop();
    return message.reply('⏹ وقفت التشغيل');
  }

  if (command === 'leave') {
    if (connection) {
      connection.destroy();
      connection = null;
    }
    return message.reply('👋 طلعت من الفويس');
  }

  if (command === 'ping') {
    return message.reply(`🏓 Pong! ${client.ws.ping}ms`);
  }
});

// Graceful shutdown — only when Railway/process stops it
process.on('SIGTERM', () => {
  console.log('SIGTERM received — shutting down gracefully');
  if (connection) connection.destroy();
  client.destroy();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received — shutting down');
  if (connection) connection.destroy();
  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
