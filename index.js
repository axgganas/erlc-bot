const { 
  Client, 
  GatewayIntentBits, 
  SlashCommandBuilder, 
  PermissionsBitField 
} = require("discord.js");

const sqlite3 = require("sqlite3").verbose();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// DATABASE
const db = new sqlite3.Database("./erlc.db");

// TABLES
db.run(`CREATE TABLE IF NOT EXISTS warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roblox_username TEXT,
  reason TEXT,
  staff TEXT,
  date TEXT
)`);

db.run(`CREATE TABLE IF NOT EXISTS shifts (
  staff_id TEXT PRIMARY KEY,
  start_time INTEGER
)`);

// READY
client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // REGISTER COMMANDS
  const commands = [
    new SlashCommandBuilder()
      .setName("warn")
      .setDescription("Warn a Roblox player")
      .addStringOption(o =>
        o.setName("username")
          .setDescription("Roblox username")
          .setRequired(true))
      .addStringOption(o =>
        o.setName("reason")
          .setDescription("Reason")
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName("warnings")
      .setDescription("View warnings for a Roblox player")
      .addStringOption(o =>
        o.setName("username")
          .setDescription("Roblox username")
          .setRequired(true)),

    new SlashCommandBuilder()
      .setName("shift")
      .setDescription("Shift system")
      .addSubcommand(sc =>
        sc.setName("start").setDescription("Start your shift"))
      .addSubcommand(sc =>
        sc.setName("end").setDescription("End your shift"))
  ];

  await client.application.commands.set(commands);
});

// PERMISSION CHECK
function hasPermission(member) {
  return member.roles.cache.some(r => 
    r.name === "─────────── High Rank ───────────" || r.name === "Low Rank"
  );
}
// INTERACTIONS
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  if (!hasPermission(member)) {
    return interaction.reply({ content: "❌ You don’t have permission.", ephemeral: true });
  }

  const logChannel = interaction.guild.channels.cache.find(c => c.name === "mod-logs");

  // WARN
  if (interaction.commandName === "warn") {
    const user = interaction.options.getString("username");
    const reason = interaction.options.getString("reason");

    db.run(
      "INSERT INTO warnings (roblox_username, reason, staff, date) VALUES (?, ?, ?, ?)",
      [user, reason, interaction.user.tag, new Date().toISOString()]
    );

    interaction.reply(`⚠️ **${user}** warned.`);
    if (logChannel) {
      logChannel.send(`⚠️ **WARN**\nUser: ${user}\nReason: ${reason}\nBy: ${interaction.user.tag}`);
    }
  }
// WARNINGS
  if (interaction.commandName === "warnings") {
    const user = interaction.options.getString("username");

    db.all(
      "SELECT * FROM warnings WHERE roblox_username = ?",
      [user],
      (err, rows) => {
        if (!rows || rows.length === 0) {
          return interaction.reply(`✅ **${user}** has no warnings.`);
        }

        const list = rows.map(w =>
          `#${w.id} - ${w.reason} (${w.staff})`
        ).join("\n");

        interaction.reply(`⚠️ Warnings for **${user}**:\n${list}`);
      }
    );
  }

  // SHIFT START
  if (interaction.commandName === "shift" && interaction.options.getSubcommand() === "start") {
    db.run(
      "INSERT OR REPLACE INTO shifts (staff_id, start_time) VALUES (?, ?)",
      [interaction.user.id, Date.now()]
    );

    interaction.reply("🟢 Shift started.");
    if (logChannel) {
      logChannel.send(`🟢 **SHIFT START**\nStaff: ${interaction.user.tag}`);
    }
  }

  // SHIFT END
  if (interaction.commandName === "shift" && interaction.options.getSubcommand() === "end") {
    db.get(
      "SELECT start_time FROM shifts WHERE staff_id = ?",
      [interaction.user.id],
      (err, row) => {
        if (!row) {
          return interaction.reply("❌ You don’t have an active shift.");
        }

        const duration = Math.floor((Date.now() - row.start_time) / 60000);
        db.run("DELETE FROM shifts WHERE staff_id = ?", [interaction.user.id]);

        interaction.reply(`🔴 Shift ended. Time worked: **${duration} minutes**.`);
        if (logChannel) {
          logChannel.send(`🔴 **SHIFT END**\nStaff: ${interaction.user.tag}\nDuration: ${duration} minutes`);
        }
      }
    );
  }
});


client.login(process.env.TOKEN);
