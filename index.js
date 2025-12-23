// =======================
// KEEP ALIVE (RENDER)
// =======================
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Bot is alive'));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Web server running on port ${PORT}`));

// =======================
// IMPORTS
// =======================
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits
} = require('discord.js');

const sqlite3 = require('sqlite3').verbose();

// =======================
// CLIENT
// =======================
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// =======================
// DATABASE
// =======================
const db = new sqlite3.Database('./database.db');
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS shifts (
      userId TEXT PRIMARY KEY,
      totalMinutes INTEGER DEFAULT 0,
      shiftStart INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT,
      moderatorId TEXT,
      reason TEXT,
      timestamp INTEGER
    )
  `);
});

// =======================
// ROLES
// =======================
const HIGH_RANK = '─────────── High Rank ───────────';
const LOW_RANK = '─────────── Low Rank ───────────';

// =======================
// COMMANDS
// =======================
const commands = [
  // ===== SHIFT =====
  new SlashCommandBuilder()
    .setName('shift')
    .setDescription('Shift commands')
    .addSubcommand(s =>
      s.setName('start').setDescription('Start your shift')
    )
    .addSubcommand(s =>
      s.setName('end').setDescription('End your shift')
    )
    .addSubcommand(s =>
      s.setName('leaderboard').setDescription('View shift leaderboard')
    ),

  // ===== WARN =====
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a staff member')
    .addUserOption(o =>
      o.setName('user')
       .setDescription('User to warn')
       .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('reason')
       .setDescription('Reason for warning')
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View warnings of a user')
    .addUserOption(o =>
      o.setName('user')
       .setDescription('User to check')
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('unwarn')
    .setDescription('Remove the most recent warning from a user')
    .addUserOption(o =>
      o.setName('user')
       .setDescription('User to unwarn')
       .setRequired(true)
    )
];

// =======================
// REGISTER COMMANDS
// =======================
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  console.log('Registering commands...');
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands.map(c => c.toJSON()) }
  );
  console.log('Commands registered!');
})();

// =======================
// READY
// =======================
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// =======================
// PERMISSION CHECK
// =======================
function hasRole(member, roleName) {
  return member.roles.cache.some(r => r.name === roleName);
}

// =======================
// INTERACTIONS
// =======================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    await interaction.deferReply({ flags: 64 });

    const member = interaction.member;

    // =======================
    // WARN
    // =======================
    if (interaction.commandName === 'warn') {
      if (!hasRole(member, HIGH_RANK)) {
        return interaction.editReply({ content: '❌ High Rank only.' });
      }

      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');

      db.run(
        'INSERT INTO warnings (userId, moderatorId, reason, timestamp) VALUES (?, ?, ?, ?)',
        [user.id, interaction.user.id, reason, Date.now()]
      );

      const embed = new EmbedBuilder()
        .setColor(0xffaa00)
        .setTitle('⚠️ Warning Issued')
        .addFields(
          { name: 'User', value: `<@${user.id}>`, inline: true },
          { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // =======================
    // WARNINGS
    // =======================
    if (interaction.commandName === 'warnings') {
      if (!hasRole(member, HIGH_RANK) && !hasRole(member, LOW_RANK)) {
        return interaction.editReply({ content: '❌ Staff only.' });
      }

      const user = interaction.options.getUser('user');

      db.all(
        'SELECT * FROM warnings WHERE userId = ? ORDER BY timestamp DESC',
        [user.id],
        (err, rows) => {
          if (!rows.length) {
            return interaction.editReply({
              content: '✅ No warnings found.'
            });
          }

          const list = rows
            .map((w, i) => `**${i + 1}.** ${w.reason} — <@${w.moderatorId}>`)
            .join('\n');

          const embed = new EmbedBuilder()
            .setColor(0xff5555)
            .setTitle(`⚠️ Warnings for ${user.tag}`)
            .setDescription(list)
            .setTimestamp();

          interaction.editReply({ embeds: [embed] });
        }
      );
    }

    // =======================
    // UNWARN
    // =======================
    if (interaction.commandName === 'unwarn') {
      if (!hasRole(member, HIGH_RANK)) {
        return interaction.editReply({ content: '❌ High Rank only.' });
      }

      const user = interaction.options.getUser('user');

      db.get(
        'SELECT * FROM warnings WHERE userId = ? ORDER BY timestamp DESC LIMIT 1',
        [user.id],
        (err, row) => {
          if (!row) {
            return interaction.editReply({ content: '❌ No warnings to remove.' });
          }

          db.run('DELETE FROM warnings WHERE id = ?', [row.id]);

          const embed = new EmbedBuilder()
            .setColor(0x00ff99)
            .setTitle('✅ Warning Removed')
            .addFields(
              { name: 'User', value: `<@${user.id}>`, inline: true },
              { name: 'Removed by', value: `<@${interaction.user.id}>`, inline: true }
            )
            .setTimestamp();

          interaction.editReply({ embeds: [embed] });
        }
      );
    }

    // =======================
    // SHIFT SYSTEM (UNCHANGED)
    // =======================
    if (interaction.commandName === 'shift') {
      const sub = interaction.options.getSubcommand();
      const userId = interaction.user.id;

      if (sub === 'start') {
        const now = Date.now();
        db.get('SELECT * FROM shifts WHERE userId = ?', [userId], (err, row) => {
          if (row?.shiftStart) {
            return interaction.editReply({ content: '❌ Shift already active.' });
          }

          if (row) {
            db.run('UPDATE shifts SET shiftStart = ? WHERE userId = ?', [now, userId]);
          } else {
            db.run(
              'INSERT INTO shifts (userId, totalMinutes, shiftStart) VALUES (?, 0, ?)',
              [userId, now]
            );
          }

          const embed = new EmbedBuilder()
            .setColor(0x00ff99)
            .setTitle('🟢 Shift Started')
            .addFields(
              { name: 'Staff', value: `<@${userId}>`, inline: true },
              { name: 'Start Time', value: `<t:${Math.floor(now / 1000)}:F>`, inline: true }
            )
            .setTimestamp();

          interaction.editReply({ embeds: [embed] });
        });
      }

      if (sub === 'end') {
        const now = Date.now();
        db.get('SELECT * FROM shifts WHERE userId = ?', [userId], (err, row) => {
          if (!row?.shiftStart) {
            return interaction.editReply({ content: '❌ No active shift.' });
          }

          const minutes = Math.floor((now - row.shiftStart) / 60000);
          const total = row.totalMinutes + minutes;

          db.run(
            'UPDATE shifts SET totalMinutes = ?, shiftStart = NULL WHERE userId = ?',
            [total, userId]
          );

          const embed = new EmbedBuilder()
            .setColor(0xff5555)
            .setTitle('🔴 Shift Ended')
            .addFields(
              { name: 'This Shift', value: `${minutes} minutes`, inline: true },
              { name: 'Total Time', value: `${total} minutes`, inline: true }
            )
            .setTimestamp();

          interaction.editReply({ embeds: [embed] });
        });
      }

      if (sub === 'leaderboard') {
        db.all(
          'SELECT * FROM shifts ORDER BY totalMinutes DESC LIMIT 10',
          [],
          (err, rows) => {
            const desc = rows.length
              ? rows.map((r, i) => `**${i + 1}.** <@${r.userId}> — ${r.totalMinutes} min`).join('\n')
              : 'No data yet.';

            const embed = new EmbedBuilder()
              .setColor(0x3498db)
              .setTitle('🏆 Shift Leaderboard')
              .setDescription(desc)
              .setTimestamp();

            interaction.editReply({ embeds: [embed] });
          }
        );
      }
    }

  } catch (err) {
    console.error(err);
    if (interaction.deferred) {
      interaction.editReply({ content: '❌ Something went wrong.' });
    }
  }
});

// =======================
// LOGIN
// =======================
client.login(process.env.TOKEN);
