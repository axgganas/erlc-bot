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
  Routes
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
    )
];

// =======================
// REGISTER COMMANDS
// =======================
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('Registering commands...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands.map(c => c.toJSON()) }
    );
    console.log('Commands registered!');
  } catch (err) {
    console.error(err);
  }
})();

// =======================
// READY
// =======================
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// =======================
// INTERACTIONS
// =======================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    await interaction.deferReply({ flags: 64 });

    // =======================
    // SHIFT START
    // =======================
    if (interaction.commandName === 'shift') {
      const sub = interaction.options.getSubcommand();
      const userId = interaction.user.id;

      if (sub === 'start') {
        db.get(
          'SELECT * FROM shifts WHERE userId = ?',
          [userId],
          (err, row) => {
            if (row?.shiftStart) {
              return interaction.editReply({
                content: '❌ You already have an active shift.'
              });
            }

            const now = Date.now();

            if (row) {
              db.run(
                'UPDATE shifts SET shiftStart = ? WHERE userId = ?',
                [now, userId]
              );
            } else {
              db.run(
                'INSERT INTO shifts (userId, totalMinutes, shiftStart) VALUES (?, ?, ?)',
                [userId, 0, now]
              );
            }

            const embed = new EmbedBuilder()
              .setColor(0x00ff99)
              .setTitle('🟢 Shift Started')
              .addFields(
                { name: 'Staff Member', value: `<@${userId}>`, inline: true },
                { name: 'Shift Started', value: `<t:${Math.floor(now / 1000)}:F>`, inline: true },
                { name: 'Current Shift', value: '0 minutes', inline: true }
              )
              .setFooter({ text: 'ERLC Shift System' })
              .setTimestamp();

            interaction.editReply({ embeds: [embed] });
          }
        );
      }

      // =======================
      // SHIFT END
      // =======================
      if (sub === 'end') {
        db.get(
          'SELECT * FROM shifts WHERE userId = ?',
          [userId],
          (err, row) => {
            if (!row || !row.shiftStart) {
              return interaction.editReply({
                content: '❌ You do not have an active shift.'
              });
            }

            const now = Date.now();
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
                { name: 'Staff Member', value: `<@${userId}>`, inline: true },
                { name: 'This Shift', value: `${minutes} minutes`, inline: true },
                { name: 'Total Time', value: `${total} minutes`, inline: true }
              )
              .setFooter({ text: 'ERLC Shift System' })
              .setTimestamp();

            interaction.editReply({ embeds: [embed] });
          }
        );
      }

      // =======================
      // LEADERBOARD
      // =======================
      if (sub === 'leaderboard') {
        db.all(
          'SELECT * FROM shifts ORDER BY totalMinutes DESC LIMIT 10',
          [],
          (err, rows) => {
            if (!rows.length) {
              return interaction.editReply({ content: 'No shift data yet.' });
            }

            const desc = rows
              .map(
                (r, i) =>
                  `**${i + 1}.** <@${r.userId}> — ${r.totalMinutes} minutes`
              )
              .join('\n');

            const embed = new EmbedBuilder()
              .setColor(0x3498db)
              .setTitle('🏆 Shift Leaderboard')
              .setDescription(desc)
              .setFooter({ text: 'ERLC Shift System' })
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
