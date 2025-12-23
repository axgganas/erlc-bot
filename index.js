// ======================
// IMPORTS
// ======================
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Routes,
  EmbedBuilder
} = require('discord.js');
const { REST } = require('@discordjs/rest');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

// ======================
// EXPRESS (KEEP ALIVE)
// ======================
const app = express();
const PORT = process.env.PORT || 5000;

app.get('/', (req, res) => res.send('Bot is alive'));
app.listen(PORT, () => console.log(`Web running on ${PORT}`));

// ======================
// CLIENT
// ======================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// ======================
// DATABASE
// ======================
const db = new sqlite3.Database('./erlc.db');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT,
    reason TEXT,
    time TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS shifts (
    userId TEXT PRIMARY KEY,
    start INTEGER,
    breakTime INTEGER,
    status TEXT
  )`);
});

// ======================
// SAFE DEFER (FIX 10062)
// ======================
async function safeDefer(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }
    return true;
  } catch {
    return false;
  }
}

// ======================
// ROLE CHECKS
// ======================
function isHighRank(member) {
  return member.roles.cache.some(r => r.name === '─────────── High Rank ───────────');
}
function isLowRank(member) {
  return member.roles.cache.some(r => r.name === '─────────── Low Rank ───────────');
}

// ======================
// EMBED
// ======================
function makeEmbed(title, desc, color) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setColor(color)
    .setTimestamp();
}

// ======================
// COMMANDS
// ======================
const commands = [
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a user')
    .addUserOption(o =>
      o.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption(o =>
      o.setName('reason').setDescription('Reason').setRequired(true)),

  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View warnings')
    .addUserOption(o =>
      o.setName('user').setDescription('User').setRequired(true)),

  new SlashCommandBuilder()
    .setName('warnremove')
    .setDescription('Remove latest warning')
    .addUserOption(o =>
      o.setName('user').setDescription('User').setRequired(true)),

  new SlashCommandBuilder()
    .setName('shift')
    .setDescription('Shift system')
    .addSubcommand(s =>
      s.setName('start').setDescription('Start your shift'))
    .addSubcommand(s =>
      s.setName('end').setDescription('End your shift'))
    .addSubcommand(s =>
      s.setName('break').setDescription('Go on break'))
    .addSubcommand(s =>
      s.setName('resume').setDescription('Resume shift'))
    .addSubcommand(s =>
      s.setName('leaderboard').setDescription('View leaderboard'))
    .addSubcommand(s =>
      s.setName('adjust')
        .setDescription('Adjust shift time (High Rank)')
        .addUserOption(o =>
          o.setName('user')
           .setDescription('User to adjust')
           .setRequired(true))
        .addIntegerOption(o =>
          o.setName('minutes')
           .setDescription('Minutes to add/remove')
           .setRequired(true)))
].map(c => c.toJSON());

// ======================
// REGISTER COMMANDS
// ======================
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
  console.log('Commands registered');
})();

// ======================
// READY
// ======================
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ======================
// INTERACTIONS
// ======================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const ok = await safeDefer(interaction);
  if (!ok) return;

  const cmd = interaction.commandName;
  const member = interaction.member;

  // WARN
  if (cmd === 'warn') {
    if (!isHighRank(member) && !isLowRank(member))
      return interaction.editReply({ content: 'No permission.' });

    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');

    db.run(
      `INSERT INTO warnings (userId, reason, time) VALUES (?, ?, ?)`,
      [user.id, reason, new Date().toISOString()]
    );

    return interaction.editReply({
      embeds: [makeEmbed('Warning Issued', `${user}\nReason: ${reason}`, '#FFD700')]
    });
  }

  // WARNINGS
  if (cmd === 'warnings') {
    const user = interaction.options.getUser('user');
    db.all(`SELECT * FROM warnings WHERE userId=?`, [user.id], (_, rows) => {
      if (!rows.length)
        return interaction.editReply({ content: 'No warnings.' });

      const text = rows.map(w => `• ${w.reason}`).join('\n');
      interaction.editReply({
        embeds: [makeEmbed(`Warnings for ${user.username}`, text, '#FFA500')]
      });
    });
  }

  // WARN REMOVE
  if (cmd === 'warnremove') {
    if (!isHighRank(member))
      return interaction.editReply({ content: 'High Rank only.' });

    const user = interaction.options.getUser('user');
    db.get(
      `SELECT id FROM warnings WHERE userId=? ORDER BY id DESC`,
      [user.id],
      (_, row) => {
        if (!row) return interaction.editReply({ content: 'No warnings.' });
        db.run(`DELETE FROM warnings WHERE id=?`, [row.id]);
        interaction.editReply({ content: 'Warning removed.' });
      }
    );
  }

  // SHIFT
  if (cmd === 'shift') {
    const sub = interaction.options.getSubcommand();
    const id = interaction.user.id;

    if (sub === 'start') {
      db.run(
        `INSERT OR REPLACE INTO shifts VALUES (?, ?, ?, ?)`,
        [id, Date.now(), 0, 'On Duty']
      );
      return interaction.editReply({ content: 'Shift started.' });
    }

    if (sub === 'end') {
      db.get(`SELECT * FROM shifts WHERE userId=?`, [id], (_, row) => {
        if (!row) return interaction.editReply({ content: 'No active shift.' });
        const mins = Math.round((Date.now() - row.start) / 60000);
        db.run(`DELETE FROM shifts WHERE userId=?`, [id]);
        interaction.editReply({ content: `Shift ended. ${mins} minutes.` });
      });
    }

    if (sub === 'leaderboard') {
      db.all(`SELECT * FROM shifts`, [], (_, rows) => {
        if (!rows.length)
          return interaction.editReply({ content: 'No data.' });

        let text = '';
        rows.forEach(r => {
          const mins = Math.round((Date.now() - r.start) / 60000);
          text += `<@${r.userId}> — ${mins} mins\n`;
        });

        interaction.editReply({
          embeds: [makeEmbed('Shift Leaderboard', text, '#00FFFF')]
        });
      });
    }
  }
});

// ======================
// LOGIN
// ======================
client.login(process.env.TOKEN);
