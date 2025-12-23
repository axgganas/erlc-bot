const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

/* ================= CONFIG ================= */
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const HIGH_RANK = '─────────── High Rank ───────────';
const LOW_RANK = '─────────── Low Rank ───────────';

/* ================= KEEP ALIVE ================= */
const app = express();
app.get('/', (req, res) => res.send('Bot alive'));
app.listen(5000, () => console.log('Web server running on port 5000'));

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

/* ================= DATABASE ================= */
const db = new sqlite3.Database('./data.db', () => console.log('Connected to SQLite database.'));

db.run(`CREATE TABLE IF NOT EXISTS warnings (
  user_id TEXT,
  reason TEXT,
  moderator TEXT,
  time INTEGER
)`);

db.run(`CREATE TABLE IF NOT EXISTS shifts (
  user_id TEXT PRIMARY KEY,
  start_time INTEGER,
  total_time INTEGER DEFAULT 0
)`);

/* ================= HELPERS ================= */
function hasRole(member, roleName) {
  return member.roles.cache.some(r => r.name === roleName);
}

function formatDuration(ms) {
  const mins = Math.floor(ms / 60000);
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

/* ================= COMMANDS ================= */
const commands = [
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a user')
    .addUserOption(o =>
      o.setName('user')
       .setDescription('The user to warn')
       .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('reason')
       .setDescription('Reason for the warning')
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View warnings for a user')
    .addUserOption(o =>
      o.setName('user')
       .setDescription('The user to view warnings for')
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Promote a staff member')
    .addUserOption(o => 
      o.setName('user')
       .setDescription('The user to promote')
       .setRequired(true)
    )
    .addRoleOption(o =>
      o.setName('from')
       .setDescription('Current role of the user')
       .setRequired(true)
    )
    .addRoleOption(o =>
      o.setName('to')
       .setDescription('Role to promote the user to')
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('demote')
    .setDescription('Demote a staff member')
    .addUserOption(o =>
      o.setName('user')
       .setDescription('The user to demote')
       .setRequired(true)
    )
    .addRoleOption(o =>
      o.setName('from')
       .setDescription('Current role of the user')
       .setRequired(true)
    )
    .addRoleOption(o =>
      o.setName('to')
       .setDescription('Role to demote the user to')
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('shift')
    .setDescription('Shift commands')
    .addSubcommand(s =>
      s.setName('start')
       .setDescription('Start your shift')
    )
    .addSubcommand(s =>
      s.setName('end')
       .setDescription('End your shift')
    )
    .addSubcommand(s =>
      s.setName('break')
       .setDescription('Go on break')
    )
];

/* ================= REGISTER ================= */
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: commands.map(c => c.toJSON()) }
  );

  console.log('Commands registered!');
});

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply({ flags: 64 });

  const member = interaction.member;

  /* ===== WARN ===== */
  if (interaction.commandName === 'warn') {
    if (!hasRole(member, HIGH_RANK) && !hasRole(member, LOW_RANK))
      return interaction.editReply('❌ No permission.');

    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');

    db.run(`INSERT INTO warnings VALUES (?, ?, ?, ?)`, [user.id, reason, interaction.user.tag, Date.now()]);

    const embed = new EmbedBuilder()
      .setColor(0xffaa00)
      .setTitle('⚠️ Warning Issued')
      .addFields(
        { name: 'User', value: `<@${user.id}>` },
        { name: 'Reason', value: reason },
        { name: 'Signed By', value: interaction.user.tag }
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  /* ===== WARNINGS ===== */
  if (interaction.commandName === 'warnings') {
    const user = interaction.options.getUser('user');

    db.all(`SELECT * FROM warnings WHERE user_id = ?`, [user.id], (err, rows) => {
      if (!rows.length)
        return interaction.editReply('No warnings.');

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle(`Warnings for ${user.tag}`)
        .setDescription(rows.map((w, i) => `**${i + 1}.** ${w.reason} — *${w.moderator}*`).join('\n'));

      interaction.editReply({ embeds: [embed] });
    });
  }

  /* ===== PROMOTE / DEMOTE ===== */
  if (['promote', 'demote'].includes(interaction.commandName)) {
    if (!hasRole(member, HIGH_RANK))
      return interaction.editReply('❌ High Rank only.');

    const user = interaction.options.getUser('user');
    const from = interaction.options.getRole('from');
    const to = interaction.options.getRole('to');

    const target = await interaction.guild.members.fetch(user.id);
    await target.roles.remove(from);
    await target.roles.add(to);

    const embed = new EmbedBuilder()
      .setColor(interaction.commandName === 'promote' ? 0x00ff99 : 0xff5555)
      .setTitle(interaction.commandName === 'promote' ? '📈 Promotion' : '📉 Demotion')
      .addFields(
        { name: 'User', value: `<@${user.id}>` },
        { name: 'From', value: from.name },
        { name: 'To', value: to.name },
        { name: 'Signed By', value: interaction.user.tag }
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  /* ===== SHIFT ===== */
  if (interaction.commandName === 'shift') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'start') {
      db.run(`INSERT OR REPLACE INTO shifts VALUES (?, ?, ?)`, [interaction.user.id, Date.now(), 0]);

      const embed = new EmbedBuilder()
        .setColor(0x00ccff)
        .setTitle('🟢 Shift Started')
        .addFields(
          { name: 'User', value: interaction.user.tag },
          { name: 'Started', value: `<t:${Math.floor(Date.now()/1000)}:R>` }
        );

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'end') {
      db.get(`SELECT * FROM shifts WHERE user_id = ?`, [interaction.user.id], (err, row) => {
        if (!row) return interaction.editReply('No active shift.');

        const duration = Date.now() - row.start_time;
        db.run(`DELETE FROM shifts WHERE user_id = ?`, [interaction.user.id]);

        const embed = new EmbedBuilder()
          .setColor(0xff4444)
          .setTitle('🔴 Shift Ended')
          .addFields(
            { name: 'User', value: interaction.user.tag },
            { name: 'Duration', value: formatDuration(duration) }
          );

        interaction.editReply({ embeds: [embed] });
      });
    }

    if (sub === 'break') {
      const embed = new EmbedBuilder()
        .setColor(0xffff00)
        .setTitle('☕ On Break')
        .addFields(
          { name: 'User', value: interaction.user.tag },
          { name: 'Status', value: 'Currently on break' }
        );

      return interaction.editReply({ embeds: [embed] });
    }
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);
