import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  TextChannel,
  Collection,
  Partials,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ButtonInteraction,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuBuilder,
  UserSelectMenuInteraction,
  EmbedBuilder,
  Guild,
  GuildMember,
  PermissionsBitField,
  Role,
  User,
  ChatInputCommandInteraction,
  ApplicationCommandOptionType,
  REST,
  Routes,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
} from "discord.js";
import Groq from "groq-sdk";
import { logger } from "./lib/logger";
import {
  hasPermission,
  getRolePerms,
  toggleRolePerm,
  getUserPerms,
  toggleUserPerm,
  ALL_COMMANDS,
  COMMAND_LABELS,
  guildHasConfig,
} from "./perms";
import * as Economy from "./economy.js";
import type { Car, CarTier } from "./cars.js";
import { CARS, CARS_PER_PAGE, TIER_EMOJI, TIER_COLOR, ALL_TIERS, getCarById, findCarByName, getCarsByTier } from "./cars.js";

const PREFIX = "-";
const MAX_SPAM_COUNT = 100;
const MAX_DELETE_COUNT = 100;
const MAX_DM_COUNT = 50;
const DISCORD_EPOCH = 1420070400000n;

const EIGHT_BALL_RESPONSES = [
  "It is certain.", "It is decidedly so.", "Without a doubt.", "Yes, definitely.", "You may rely on it.",
  "As I see it, yes.", "Most likely.", "Outlook good.", "Yes.", "Signs point to yes.",
  "Reply hazy, try again.", "Ask again later.", "Better not tell you now.", "Cannot predict now.", "Concentrate and ask again.",
  "Don't count on it.", "My reply is no.", "My sources say no.", "Outlook not so good.", "Very doubtful.",
];

const RPS_MOVES = ["rock", "paper", "scissors"] as const;
type RpsMove = typeof RPS_MOVES[number];
const RPS_EMOJI: Record<RpsMove, string> = { rock: "🪨", paper: "📄", scissors: "✂️" };
function rpsResult(player: RpsMove, bot: RpsMove): string {
  if (player === bot) return "draw";
  if ((player === "rock" && bot === "scissors") || (player === "paper" && bot === "rock") || (player === "scissors" && bot === "paper")) return "win";
  return "lose";
}

function mockText(text: string): string {
  return [...text].map((c, i) => i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()).join("");
}

interface SnipeEntry { content: string; authorName: string; authorAvatar: string; deletedAt: Date; }
const snipeCache = new Map<string, SnipeEntry>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  });
}

function formatAge(date: Date): string {
  const ms = Date.now() - date.getTime();
  const days = Math.floor(ms / 86400000);
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  const remDays = days % 30;
  if (years > 0) return `${years}y ${months > 0 ? `${months}mo` : ""}`.trim();
  if (months > 0) return `${months}mo ${remDays > 0 ? `${remDays}d` : ""}`.trim();
  if (days > 0) return `${days} day${days !== 1 ? "s" : ""}`;
  const hours = Math.floor(ms / 3600000);
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(ms / 60000)}m`;
}

function decodeSnowflake(id: string) {
  const sf = BigInt(id);
  const timestamp = Number((sf >> 22n) + DISCORD_EPOCH);
  const workerId = Number((sf & 0x3E0000n) >> 17n);
  const processId = Number((sf & 0x1F000n) >> 12n);
  const increment = Number(sf & 0xFFFn);
  const binary = sf.toString(2).padStart(64, "0");
  return { timestamp, workerId, processId, increment, binary };
}

const NOTABLE_PERMISSIONS: [keyof typeof PermissionsBitField.Flags, string][] = [
  ["Administrator", "👑 Administrator"],
  ["ManageGuild", "🏛️ Manage Server"],
  ["ManageRoles", "🎭 Manage Roles"],
  ["ManageChannels", "📋 Manage Channels"],
  ["KickMembers", "👢 Kick Members"],
  ["BanMembers", "🔨 Ban Members"],
  ["ManageMessages", "✂️ Manage Messages"],
  ["ManageWebhooks", "🪝 Manage Webhooks"],
  ["ManageNicknames", "✏️ Manage Nicknames"],
  ["MentionEveryone", "📢 Mention @everyone"],
  ["ViewAuditLog", "📜 View Audit Log"],
  ["MoveMembers", "🚚 Move Members"],
  ["MuteMembers", "🔇 Mute Members"],
  ["DeafenMembers", "🙉 Deafen Members"],
  ["ManageEvents", "📅 Manage Events"],
  ["ModerateMembers", "🛡️ Timeout Members"],
  ["ManageThreads", "🧵 Manage Threads"],
  ["ManageGuildExpressions", "😀 Manage Expressions"],
  ["ViewGuildInsights", "📊 View Server Insights"],
  ["SendMessages", "💬 Send Messages"],
  ["EmbedLinks", "🔗 Embed Links"],
  ["AttachFiles", "📎 Attach Files"],
  ["UseExternalEmojis", "😄 External Emojis"],
  ["UseExternalStickers", "🎭 External Stickers"],
  ["AddReactions", "❤️ Add Reactions"],
  ["UseApplicationCommands", "🤖 Use Slash Commands"],
  ["CreatePublicThreads", "🧵 Create Threads"],
  ["PrioritySpeaker", "🎙️ Priority Speaker"],
  ["Stream", "📺 Video/Stream"],
  ["Connect", "🔊 Connect to Voice"],
  ["Speak", "🎤 Speak in Voice"],
  ["UseVAD", "🎧 Voice Activity"],
  ["RequestToSpeak", "✋ Request to Speak"],
];

const MEMBER_FLAG_LABELS: Record<string, string> = {
  DidRejoin: "🔄 Rejoined the server",
  CompletedOnboarding: "✅ Completed onboarding",
  BypassesVerification: "🔓 Bypasses verification",
  StartedOnboarding: "🚀 Started onboarding",
  StartedHomeActions: "🏠 Started home actions",
  CompletedHomeActions: "🏁 Completed home actions",
  AutomodQuarantinedUsername: "⚠️ AutoMod quarantined username",
};

const USER_FLAG_LABELS: Record<string, string> = {
  ActiveDeveloper: "🧑‍💻 Active Developer",
  BotHTTPInteractions: "🤖 Supports Slash Commands",
  BugHunterLevel1: "🐛 Bug Hunter Level 1",
  BugHunterLevel2: "🏆 Bug Hunter Level 2",
  CertifiedModerator: "🛡️ Discord Certified Moderator",
  HypeSquadOnlineHouse1: "🏠 HypeSquad Bravery",
  HypeSquadOnlineHouse2: "💎 HypeSquad Brilliance",
  HypeSquadOnlineHouse3: "⚖️ HypeSquad Balance",
  Hypesquad: "🎉 HypeSquad Events",
  Partner: "🤝 Partnered Server Owner",
  PremiumEarlySupporter: "⭐ Early Supporter",
  Staff: "👑 Discord Staff",
  TeamPseudoUser: "👥 Team Account",
  VerifiedBot: "✅ Verified Bot",
  VerifiedDeveloper: "🔬 Early Verified Bot Developer",
  Spammer: "🚫 Known Spammer",
  Quarantined: "🔒 Quarantined",
};

// ─── AI ───────────────────────────────────────────────────────────────────────

let aiEnabled = false;
let botLocked = false;
const conversations = new Map<string, { role: "user" | "assistant"; content: string }[]>();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Tool definition for role management
const ROLE_TOOL = {
  type: "function" as const,
  function: {
    name: "manage_role",
    description:
      "Add or remove a Discord role from a server member. Call this when the user asks to give, add, assign, remove, or take away a role from someone.",
    parameters: {
      type: "object",
      properties: {
        user_query: {
          type: "string",
          description: "The username, display name, nickname, or user ID of the target member",
        },
        role_query: {
          type: "string",
          description: "The role name or role ID to add or remove",
        },
      },
      required: ["user_query", "role_query"],
    },
  },
};

// ─── Tic-Tac-Toe ─────────────────────────────────────────────────────────────

type Cell = "X" | "O" | null;
interface TicTacToeGame {
  board: Cell[];
  players: [string, string];
  playerNames: [string, string];
  currentTurn: 0 | 1;
}
const tttGames = new Map<string, TicTacToeGame>();
const WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function checkWinner(board: Cell[]): Cell {
  for (const [a, b, c] of WIN_LINES)
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  return null;
}

function buildTttComponents(board: Cell[], disabled = false) {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let r = 0; r < 3; r++) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c;
      const cell = board[idx];
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ttt_${idx}`)
          .setStyle(cell === "X" ? ButtonStyle.Danger : cell === "O" ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setLabel(cell ?? "·")
          .setDisabled(disabled || cell !== null),
      );
    }
    rows.push(row);
  }
  return rows;
}

function buildTttStatus(game: TicTacToeGame, result?: "win" | "draw"): string {
  if (result === "draw") return `❌ ⭕ It's a **draw**! Well played, ${game.playerNames[0]} and ${game.playerNames[1]}.`;
  if (result === "win") return `${game.currentTurn === 0 ? "❌" : "⭕"} **${game.playerNames[game.currentTurn]}** wins!`;
  return `${game.currentTurn === 0 ? "❌" : "⭕"} **${game.playerNames[game.currentTurn]}**'s turn`;
}

// ─── Perms UI ─────────────────────────────────────────────────────────────────

function buildPermTabs(active: "roles" | "members"): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("perm_tab_roles")
      .setLabel("👥 Roles")
      .setStyle(active === "roles" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("perm_tab_members")
      .setLabel("👤 Members")
      .setStyle(active === "members" ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
}

function buildRoleSelect(_guild: Guild) {
  return new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("perm_role_select")
      .setPlaceholder("Choose a role to configure...")
      .setMinValues(1)
      .setMaxValues(1),
  );
}

function buildUserSelect() {
  return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId("perm_user_select")
      .setPlaceholder("Choose a member to configure...")
      .setMinValues(1)
      .setMaxValues(1),
  );
}

const CMDS_PER_PAGE = 16; // 4 rows × 4 buttons, leaving row 5 for navigation

function buildCommandButtons(guildId: string, roleId: string, page = 0) {
  const allowed = new Set(getRolePerms(guildId, roleId));
  const totalPages = Math.ceil(ALL_COMMANDS.length / CMDS_PER_PAGE);
  const pageCmds = ALL_COMMANDS.slice(page * CMDS_PER_PAGE, (page + 1) * CMDS_PER_PAGE);
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < pageCmds.length; i += 4) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const cmd of pageCmds.slice(i, i + 4)) {
      const isAllowed = allowed.has(cmd);
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`perm_toggle_${roleId}_${page}_${cmd}`)
          .setLabel(COMMAND_LABELS[cmd] ?? cmd)
          .setStyle(isAllowed ? ButtonStyle.Success : ButtonStyle.Danger)
          .setEmoji(isAllowed ? "✅" : "❌"),
      );
    }
    rows.push(row);
  }
  const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("perm_back").setLabel("← Roles").setStyle(ButtonStyle.Secondary),
    ...(page > 0 ? [new ButtonBuilder().setCustomId(`perm_rolepage_${roleId}_${page - 1}`).setLabel("◀ Prev").setStyle(ButtonStyle.Secondary)] : []),
    ...(page < totalPages - 1 ? [new ButtonBuilder().setCustomId(`perm_rolepage_${roleId}_${page + 1}`).setLabel("Next ▶").setStyle(ButtonStyle.Secondary)] : []),
    new ButtonBuilder().setLabel(`Page ${page + 1}/${totalPages}`).setCustomId("perm_noop").setStyle(ButtonStyle.Secondary).setDisabled(true),
  );
  rows.push(nav);
  return rows;
}

function buildMemberCommandButtons(guildId: string, userId: string, page = 0) {
  const allowed = new Set(getUserPerms(guildId, userId));
  const totalPages = Math.ceil(ALL_COMMANDS.length / CMDS_PER_PAGE);
  const pageCmds = ALL_COMMANDS.slice(page * CMDS_PER_PAGE, (page + 1) * CMDS_PER_PAGE);
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < pageCmds.length; i += 4) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const cmd of pageCmds.slice(i, i + 4)) {
      const isAllowed = allowed.has(cmd);
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`perm_usertoggle_${userId}_${page}_${cmd}`)
          .setLabel(COMMAND_LABELS[cmd] ?? cmd)
          .setStyle(isAllowed ? ButtonStyle.Success : ButtonStyle.Danger)
          .setEmoji(isAllowed ? "✅" : "❌"),
      );
    }
    rows.push(row);
  }
  const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("perm_back_members").setLabel("← Members").setStyle(ButtonStyle.Secondary),
    ...(page > 0 ? [new ButtonBuilder().setCustomId(`perm_memberpage_${userId}_${page - 1}`).setLabel("◀ Prev").setStyle(ButtonStyle.Secondary)] : []),
    ...(page < totalPages - 1 ? [new ButtonBuilder().setCustomId(`perm_memberpage_${userId}_${page + 1}`).setLabel("Next ▶").setStyle(ButtonStyle.Secondary)] : []),
    new ButtonBuilder().setLabel(`Page ${page + 1}/${totalPages}`).setCustomId("perm_noop_m").setStyle(ButtonStyle.Secondary).setDisabled(true),
  );
  rows.push(nav);
  return rows;
}

// ─── Role command (shared) ────────────────────────────────────────────────────

async function handleRoleCommand(args: string[], message: Message): Promise<void> {
  const ownerId = process.env.DISCORD_OWNER_ID;
  if (message.author.id !== ownerId) { await message.channel.send("Only the bot owner can use the role command."); return; }
  const guild = message.guild;
  if (!guild) { await message.channel.send("This command can only be used in a server."); return; }
  if (args.length < 2) {
    await message.channel.send("Usage: `-role <username or ID> <role name or ID>`\nThe role is toggled — added if the user doesn't have it, removed if they do.");
    return;
  }
  const userQuery = args[0].replace(/[<@!>]/g, "");
  const roleQuery = args.slice(1).join(" ").replace(/[<@&>]/g, "");

  let member: GuildMember | null = null;
  if (/^\d+$/.test(userQuery)) {
    member = await guild.members.fetch(userQuery).catch(() => null);
  } else {
    const results = await guild.members.search({ query: userQuery, limit: 10 }).catch(() => null);
    member =
      results?.find((m) => m.user.username.toLowerCase() === userQuery.toLowerCase() || m.displayName.toLowerCase() === userQuery.toLowerCase()) ??
      results?.first() ?? null;
  }
  if (!member) { await message.channel.send(`❌ Could not find member **${args[0]}**.`); return; }

  let role: Role | null = null;
  if (/^\d+$/.test(roleQuery)) {
    role = guild.roles.cache.get(roleQuery) ?? (await guild.roles.fetch(roleQuery).catch(() => null));
  } else {
    role = guild.roles.cache.find((r) => r.name.toLowerCase() === roleQuery.toLowerCase()) ?? null;
  }
  if (!role) { await message.channel.send(`❌ Could not find role **${roleQuery}**.`); return; }
  if (role.managed) { await message.channel.send(`❌ **${role.name}** is a managed role and cannot be assigned manually.`); return; }

  try {
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role);
      await message.channel.send(`✅ Removed **${role.name}** from **${member.displayName}**.`);
    } else {
      await member.roles.add(role);
      await message.channel.send(`✅ Added **${role.name}** to **${member.displayName}**.`);
    }
  } catch (err) {
    logger.error({ err }, "Role modify failed");
    await message.channel.send("❌ Failed to modify role. Make sure the bot has **Manage Roles** permission and the role is below its highest role.");
  }
}

// ─── User Info Embeds ─────────────────────────────────────────────────────────

interface UserEmbedSession {
  embeds: Record<string, EmbedBuilder>;
  hasMember: boolean;
  current: string;
}
const userEmbedCache = new Map<string, UserEmbedSession>();

function scheduleCleanup(msgId: string) {
  setTimeout(() => userEmbedCache.delete(msgId), 30 * 60 * 1000);
}

// ─── Help embed cache ──────────────────────────────────────────────────────────
interface HelpEmbedSession {
  embeds: Record<string, EmbedBuilder>;
  inDM: boolean;
  current: string;
}
const helpEmbedCache = new Map<string, HelpEmbedSession>();
function scheduleHelpCleanup(msgId: string) {
  setTimeout(() => helpEmbedCache.delete(msgId), 30 * 60 * 1000);
}

const HELP_CATS = [
  { id: "home",      label: "🏠 Home",         style: ButtonStyle.Secondary },
  { id: "games",     label: "🎮 Games",         style: ButtonStyle.Primary   },
  { id: "fun",       label: "🎭 Fun",           style: ButtonStyle.Primary   },
  { id: "messaging", label: "📢 Messaging",     style: ButtonStyle.Primary   },
  { id: "info",      label: "🔍 Info & Tools",  style: ButtonStyle.Primary   },
  { id: "economy",   label: "💰 Economy",       style: ButtonStyle.Success   },
  { id: "owner",     label: "👑 Owner Only",    style: ButtonStyle.Danger    },
] as const;

function buildHelpNavButtons(msgId: string, inDM: boolean, current: string): ActionRowBuilder<ButtonBuilder>[] {
  const cats = inDM ? HELP_CATS.filter(c => c.id !== "owner") : [...HELP_CATS];
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < cats.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const cat of cats.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`help_cat_${msgId}_${cat.id}`)
          .setLabel(cat.label)
          .setStyle(current === cat.id ? ButtonStyle.Success : cat.style)
          .setDisabled(current === cat.id),
      );
    }
    rows.push(row);
  }
  return rows;
}

function buildHelpEmbeds(inDM: boolean, footer: { text: string; iconURL: string }): Record<string, EmbedBuilder> {
  const color = 0x5865f2;
  const base = (title: string) =>
    new EmbedBuilder().setColor(color).setTitle(title).setFooter(footer).setTimestamp();

  const embeds: Record<string, EmbedBuilder> = {};

  // HOME
  embeds.home = base("📖 Help — Command Center").setDescription(
    [
      "Use **prefix** `-` or **slash** `/` for all commands.",
      "Pick a category with the buttons below.",
      "",
      "🎮 **Games** — 8-Ball, Rock Paper Scissors, Dice Roll, Coin Flip, Tic-Tac-Toe",
      "🎭 **Fun** — Mock Text, AI Compliments",
      "📢 **Messaging** — Say, Spam, Spam as Me, DM, Silent Ping",
      "🔍 **Info & Tools** — User Info, Avatar, Latency, Snipe, Delete",
      "💰 **Economy** — Balance, Give Money, Car Shop, Buy Cars, Garage",
      ...(!inDM ? ["👑 **Owner Only** — Role Management, AI Toggle, Permissions"] : []),
      "",
      "**AI Mode:** Mention me or reply to me to chat!",
    ].join("\n"),
  );

  // GAMES
  embeds.games = base("🎮 Games").addFields(
    { name: "`8ball <question>`",            value: "Ask the magic 8-ball — 20 possible answers",                                                              inline: false },
    { name: "`rps <rock/paper/scissors>`",   value: "Play Rock Paper Scissors against the bot",                                                                inline: false },
    { name: "`roll [NdN]`",                  value: "Roll dice in standard notation (e.g. `2d6`, `1d20`). Defaults to `1d6`. Max 20 dice, 1000 sides",        inline: false },
    { name: "`flip`",                        value: "Flip a coin — heads or tails",                                                                           inline: false },
    { name: "`ttt @user`",                   value: "Challenge someone to a game of Tic-Tac-Toe *(server only)*",                                             inline: false },
  );

  // FUN
  embeds.fun = base("🎭 Fun").addFields(
    { name: "`mock <text>`",          value: "cOnVeRtS yOuR tExT tO mOcKiNg SpOnGeBoB cAsE",                                                      inline: false },
    { name: "`compliment @user`",     value: "Generates a warm, AI-written compliment for someone *(server only)*",                                 inline: false },
  );

  // MESSAGING
  embeds.messaging = base("📢 Messaging").addFields(
    { name: "`say <message>`",                        value: "Make the bot say something in the current channel",                                                                                    inline: false },
    { name: `\`spam <count> [#channel] <message>\``,  value: `Send a message up to **${MAX_SPAM_COUNT}** times. Target a different channel optionally. Works in DMs too`,                          inline: false },
    { name: `\`spamme <count> [#channel] <message>\``,value: "Send a message that looks like it came **from you** via webhook *(server only)*",                                                     inline: false },
    { name: `\`dm @user [count] <message>\``,         value: `Slide into someone's DMs up to **${MAX_DM_COUNT}** times. Add \`--ping\` to also ping them in the channel *(server only)*`,          inline: false },
    { name: "`ping <username>`",                      value: "Silently ping a user — mentions them then instantly deletes the ping message *(server only)*",                                       inline: false },
  );

  // INFO & TOOLS
  embeds.info = base("🔍 Info & Tools").addFields(
    { name: "`user <userid>`",              value: "Full paginated OSINT-style profile — identity, appearance, badges, technical data, mutual servers & more",                          inline: false },
    { name: "`avatar [@user]`",             value: "Show someone's full-size avatar (4096px) with PNG/WebP/GIF download links. Defaults to yourself",                                   inline: false },
    { name: "`latency`",                    value: "Check the bot's current WebSocket ping",                                                                                            inline: false },
    { name: "`snipe`",                      value: "Reveal the last deleted message in this channel *(server only)*",                                                                   inline: false },
    { name: `\`delete <count> [user]\``,    value: `Bulk delete up to **${MAX_DELETE_COUNT}** messages in the channel. Optionally filter by a username *(server only)*`,              inline: false },
  );

  // ECONOMY
  embeds.economy = base("💰 Economy").addFields(
    { name: "`balance [@user]`",                value: "Check your current coin balance, or peek at someone else's",                                                                      inline: false },
    { name: "`givemoney @user <amount>`",        value: "Transfer coins from your wallet to another user",                                                                                inline: false },
    { name: "`addmoney @user <amount>`",         value: "*(Owner)* Add coins to a user's wallet",                                                                                         inline: false },
    { name: "`takemoney @user <amount>`",        value: "*(Owner)* Remove coins from a user's wallet",                                                                                    inline: false },
    { name: "`shop`",                            value: "Browse the car shop — 20 unique cars across 5 tiers (Budget → Ultra-Rare). Use ◀/▶ to flip through pages",                     inline: false },
    { name: "`buy <car name>`",                  value: "Purchase a car from the shop. You keep it forever and can view it any time in your garage",                                      inline: false },
    { name: "`garage [@user]`",                  value: "Open your car collection. Click any car button to view its image and open it on Google Images",                                  inline: false },
  );

  // OWNER
  if (!inDM) {
    embeds.owner = base("👑 Owner Only")
      .setDescription("These commands are restricted to the bot owner.")
      .addFields(
        { name: "`role <user> <role>`", value: "Toggle a role on a server member — adds it if missing, removes it if present",                                                         inline: false },
        { name: "`ai on/off`",          value: "Toggle the AI assistant. When enabled, mention the bot or reply to it to start a conversation",                                        inline: false },
        { name: "`perms`",              value: "Open the permission manager — configure which roles can use which commands on a per-server basis",                                      inline: false },
      );
  }

  return embeds;
}

// ─── SpamMe sessions ──────────────────────────────────────────────────────────
interface SpamMeSession {
  userId: string;
  count: number;
  text: string;
  channelId: string;
  guildId: string | null;
  displayName: string;
  avatarUrl: string;
}
const spamMeSessions = new Map<string, SpamMeSession>();

async function sendViaWebhook(channel: TextChannel, displayName: string, avatarUrl: string, text: string, count: number) {
  const existing = (await channel.fetchWebhooks()).find((w) => w.owner?.id === client.user?.id && w.name === "GTBP Relay");
  const webhook = existing ?? (await channel.createWebhook({ name: "GTBP Relay", avatar: client.user?.displayAvatarURL() }));
  for (let i = 0; i < count; i++) await webhook.send({ content: text, username: displayName, avatarURL: avatarUrl });
}

async function buildUserEmbeds(
  user: User,
  member: GuildMember | null,
  guildId: string | null,
  footer: { text: string; iconURL: string },
): Promise<Record<string, EmbedBuilder>> {
  const color = user.accentColor ?? 0x5865f2;
  const avatarUrl = user.displayAvatarURL({ size: 4096 });
  const avatarHash = user.avatar;
  const bannerHash = user.banner;
  const bannerUrl = user.bannerURL({ size: 4096 }) ?? null;
  const avatarAnimated = avatarHash?.startsWith("a_") ?? false;
  const bannerAnimated = bannerHash?.startsWith("a_") ?? false;
  const accentHex = user.accentColor != null ? `#${user.accentColor.toString(16).padStart(6, "0").toUpperCase()}` : null;
  const createdAt = user.createdAt;
  const unixTs = Math.floor(createdAt.getTime() / 1000);
  const { workerId, processId, increment, binary } = decodeSnowflake(user.id);
  const flags = user.flags?.toArray() ?? [];
  const rawFlagBits = user.flags?.bitfield ?? 0;
  const badges = flags.map((f) => USER_FLAG_LABELS[f] ?? f).filter(Boolean);
  const isNewSystem = user.discriminator === "0";
  const mutualGuilds = client.guilds.cache.filter((g) => g.members.cache.has(user.id));

  // Try to get avatar decoration
  const decorationUrl = (user as any).avatarDecorationURL?.() ?? null;

  function base(title: string) {
    return new EmbedBuilder()
      .setColor(color)
      .setAuthor({ name: `${user.username}`, iconURL: avatarUrl })
      .setTitle(title)
      .setFooter(footer)
      .setTimestamp();
  }

  const embeds: Record<string, EmbedBuilder> = {};

  // ── HOME ──
  embeds.home = base(`${user.globalName ?? user.username}`)
    .setThumbnail(avatarUrl)
    .setDescription([
      `**${user.globalName ?? user.username}**`,
      `\`${user.username}\` · \`${user.id}\``,
      `${user.system ? "⚙️ System" : user.bot ? "🤖 Bot" : "👤 Human"} · ${isNewSystem ? "New username" : `Legacy tag #${user.discriminator}`}`,
      ``,
      `📅 Created <t:${unixTs}:D> (<t:${unixTs}:R>)`,
      member?.joinedAt ? `📥 Joined server <t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : "",
      badges.length > 0 ? `🏅 ${badges.length} badge${badges.length !== 1 ? "s" : ""}` : "",
      mutualGuilds.size > 0 ? `🌐 ${mutualGuilds.size} mutual server${mutualGuilds.size !== 1 ? "s" : ""}` : "",
      member ? `🎭 ${member.roles.cache.size - 1} role${member.roles.cache.size !== 2 ? "s" : ""}` : "",
    ].filter(Boolean).join("\n"))
    .addFields({ name: "📂 Navigate", value: "Use the buttons below to explore each category.", inline: false });
  if (bannerUrl) embeds.home.setImage(bannerUrl);

  // ── IDENTITY ──
  embeds.identity = base("🪪 Identity & Account")
    .setThumbnail(avatarUrl)
    .addFields(
      { name: "User ID", value: `\`${user.id}\``, inline: true },
      { name: "Username", value: `\`${user.username}\``, inline: true },
      { name: "Display Name", value: user.globalName ?? "None", inline: true },
      { name: "Account Type", value: user.system ? "⚙️ System" : user.bot ? "🤖 Bot" : "👤 Human", inline: true },
      { name: "Username System", value: isNewSystem ? "New (no discriminator)" : `Legacy (#${user.discriminator})`, inline: true },
      { name: "Bot?", value: user.bot ? "Yes" : "No", inline: true },
      { name: "System?", value: user.system ? "Yes" : "No", inline: true },
      { name: "Created", value: `<t:${unixTs}:F>\n<t:${unixTs}:R>`, inline: true },
      { name: "Unix Timestamp", value: `\`${unixTs}\``, inline: true },
      { name: "Account Age", value: formatAge(createdAt), inline: true },
      { name: "Days Old", value: `${Math.floor((Date.now() - createdAt.getTime()) / 86400000).toLocaleString()} days`, inline: true },
      { name: "Profile URL", value: `[discord.com/users/${user.id}](https://discord.com/users/${user.id})`, inline: false },
    );

  // ── APPEARANCE ──
  const avatarFormats = avatarHash
    ? [
        `[WebP](${user.displayAvatarURL({ size: 4096, extension: "webp" })})`,
        `[PNG](${user.displayAvatarURL({ size: 4096, extension: "png" })})`,
        `[JPG](${user.displayAvatarURL({ size: 4096, extension: "jpg" })})`,
        avatarAnimated ? `[GIF](${user.displayAvatarURL({ size: 4096, extension: "gif" })})` : null,
      ].filter(Boolean).join(" · ")
    : null;

  embeds.appearance = base("🖼️ Appearance")
    .setThumbnail(avatarUrl)
    .addFields(
      {
        name: "🖼️ Avatar",
        value: avatarHash
          ? [`**Hash:** \`${avatarHash}\``, `**Animated:** ${avatarAnimated ? "Yes (GIF)" : "No (Static)"}`, `**Formats:** ${avatarFormats}`].join("\n")
          : "Default avatar (no custom avatar set)",
        inline: false,
      },
      {
        name: "🎀 Avatar Decoration",
        value: decorationUrl ? `[View Decoration](${decorationUrl})` : "None",
        inline: true,
      },
      {
        name: "🎨 Accent Color",
        value: accentHex ? `\`${accentHex}\` (decimal: ${user.accentColor})` : "None",
        inline: true,
      },
      {
        name: "🖼️ Banner",
        value: bannerHash
          ? [`**Hash:** \`${bannerHash}\``, `**Animated:** ${bannerAnimated ? "Yes (GIF)" : "No"}`, `**Link:** [View Banner](${bannerUrl})`].join("\n")
          : "No banner",
        inline: false,
      },
    );
  if (bannerUrl) embeds.appearance.setImage(bannerUrl);

  if (member) {
    const memberAvatarUrl = member.displayAvatarURL({ size: 4096 });
    const memberAvatarHash = member.avatar;
    if (memberAvatarHash) {
      embeds.appearance.addFields({
        name: "🏠 Server-Specific Avatar",
        value: [
          `**Hash:** \`${memberAvatarHash}\``,
          `**Animated:** ${memberAvatarHash.startsWith("a_") ? "Yes (GIF)" : "No"}`,
          `**Link:** [View](${memberAvatarUrl})`,
        ].join("\n"),
        inline: false,
      });
    }
    embeds.appearance.addFields({
      name: "🎨 Role Display Color",
      value: member.displayHexColor && member.displayHexColor !== "#000000"
        ? `\`${member.displayHexColor.toUpperCase()}\` (from highest colored role)`
        : "None (no colored role)",
      inline: true,
    });
  }

  // ── BADGES & FLAGS ──
  embeds.badges = base("🏅 Badges & Flags")
    .setThumbnail(avatarUrl)
    .addFields(
      {
        name: `🏅 Discord Badges (${badges.length})`,
        value: badges.length > 0 ? badges.join("\n") : "None",
        inline: false,
      },
      {
        name: "🔢 Raw Public Flags Bitfield",
        value: rawFlagBits > 0
          ? `Decimal: \`${rawFlagBits}\`\nBinary:  \`${rawFlagBits.toString(2).padStart(17, "0")}\``
          : "None (`0`)",
        inline: false,
      },
      {
        name: "🚩 Individual Flags Set",
        value: flags.length > 0 ? flags.map((f) => `\`${f}\``).join(", ") : "None",
        inline: false,
      },
    );
  if (member) {
    const mFlags = member.flags?.toArray() ?? [];
    const mBadges = mFlags.map((f) => MEMBER_FLAG_LABELS[String(f)] ?? String(f));
    embeds.badges.addFields({
      name: `🏠 Server Member Flags (${mBadges.length})`,
      value: mBadges.length > 0 ? mBadges.join("\n") : "None",
      inline: false,
    });
  }

  // ── TECHNICAL ──
  embeds.technical = base("🔬 Technical Data")
    .setThumbnail(avatarUrl)
    .addFields(
      { name: "❄️ Snowflake ID", value: `\`${user.id}\``, inline: false },
      { name: "🕐 Creation Timestamp", value: `\`${createdAt.getTime()}\` ms since epoch`, inline: true },
      { name: "⚙️ Internal Worker ID", value: `\`${workerId}\``, inline: true },
      { name: "🔄 Internal Process ID", value: `\`${processId}\``, inline: true },
      { name: "#️⃣ Sequence Increment", value: `\`${increment}\``, inline: true },
      { name: "🌐 Discord Epoch Offset", value: `\`${Number(BigInt(user.id) >> 22n)}\` ms`, inline: true },
      { name: "🔢 64-bit Binary Snowflake", value: `\`\`\`${binary.slice(0,32)}\n${binary.slice(32)}\`\`\``, inline: false },
      {
        name: "🖼️ Avatar CDN Base",
        value: avatarHash
          ? `\`https://cdn.discordapp.com/avatars/${user.id}/${avatarHash}\``
          : "No custom avatar",
        inline: false,
      },
      {
        name: "🖼️ Banner CDN Base",
        value: bannerHash
          ? `\`https://cdn.discordapp.com/banners/${user.id}/${bannerHash}\``
          : "No banner",
        inline: false,
      },
    );

  // ── NETWORK ──
  embeds.network = base("🌐 Network & Links")
    .setThumbnail(avatarUrl)
    .addFields(
      { name: "🔗 Profile", value: `[View Profile](https://discord.com/users/${user.id})`, inline: true },
      { name: "💬 Open DM", value: `[Message](https://discord.com/users/${user.id})`, inline: true },
      {
        name: `🌐 Mutual Servers (${mutualGuilds.size})`,
        value: mutualGuilds.size > 0
          ? mutualGuilds.map((g) => `• **${g.name}** (\`${g.id}\`)`).slice(0, 10).join("\n") +
            (mutualGuilds.size > 10 ? `\n*(+${mutualGuilds.size - 10} more)*` : "")
          : "None detected in cache",
        inline: false,
      },
    );
  if (avatarHash) {
    embeds.network.addFields({
      name: "🖼️ Avatar Direct URLs",
      value: [
        `**WebP:** [Link](${user.displayAvatarURL({ size: 4096, extension: "webp" })})`,
        `**PNG:** [Link](${user.displayAvatarURL({ size: 4096, extension: "png" })})`,
        avatarAnimated ? `**GIF:** [Link](${user.displayAvatarURL({ size: 4096, extension: "gif" })})` : null,
      ].filter(Boolean).join(" · "),
      inline: false,
    });
  }
  if (bannerUrl) {
    embeds.network.addFields({
      name: "🎨 Banner Direct URLs",
      value: [
        `**WebP:** [Link](${user.bannerURL({ size: 4096, extension: "webp" })})`,
        `**PNG:** [Link](${user.bannerURL({ size: 4096, extension: "png" })})`,
        bannerAnimated ? `**GIF:** [Link](${user.bannerURL({ size: 4096, extension: "gif" })})` : null,
      ].filter(Boolean).join(" · "),
      inline: false,
    });
  }

  // ── SERVER-SPECIFIC (only if member) ──
  if (member) {
    const joinedAt = member.joinedAt;
    const joinUnix = joinedAt ? Math.floor(joinedAt.getTime() / 1000) : null;
    const boostSince = member.premiumSince;
    const timedOutUntil = member.communicationDisabledUntil;
    const isTimedOut = timedOutUntil && timedOutUntil > new Date();
    const voice = member.voice;
    const isPending = member.pending;

    embeds.server = base("🏠 Server Member Info")
      .setThumbnail(member.displayAvatarURL({ size: 4096 }))
      .addFields(
        { name: "👤 Nickname", value: member.nickname ?? "None", inline: true },
        { name: "⏳ Pending", value: isPending ? "Yes — hasn't accepted rules" : "No", inline: true },
        { name: "📥 Joined Server", value: joinUnix ? `<t:${joinUnix}:F>\n<t:${joinUnix}:R>` : "Unknown", inline: true },
        { name: "📅 Join Age", value: joinedAt ? formatAge(joinedAt) : "Unknown", inline: true },
        {
          name: "🚀 Server Boosting",
          value: boostSince
            ? `Since <t:${Math.floor(boostSince.getTime() / 1000)}:D> (<t:${Math.floor(boostSince.getTime() / 1000)}:R>)`
            : "Not boosting",
          inline: false,
        },
        {
          name: "🔇 Timeout",
          value: isTimedOut ? `Until <t:${Math.floor(timedOutUntil!.getTime() / 1000)}:F>` : "Not timed out",
          inline: true,
        },
        {
          name: "🎙️ Voice State",
          value: voice.channel
            ? [
                `**Channel:** ${voice.channel.name} (\`${voice.channel.id}\`)`,
                `**Server Muted:** ${voice.serverMute ? "✅" : "❌"}`,
                `**Server Deafened:** ${voice.serverDeaf ? "✅" : "❌"}`,
                `**Self Muted:** ${voice.selfMute ? "✅" : "❌"}`,
                `**Self Deafened:** ${voice.selfDeaf ? "✅" : "❌"}`,
                `**Streaming:** ${voice.streaming ? "✅" : "❌"}`,
                `**Camera On:** ${voice.selfVideo ? "✅" : "❌"}`,
              ].join("\n")
            : "Not in a voice channel",
          inline: false,
        },
      );

    // ── PERMISSIONS ──
    const perms = member.permissions;
    const granted = NOTABLE_PERMISSIONS.filter(([flag]) => perms.has(PermissionsBitField.Flags[flag]));
    const rawPermBits = perms.bitfield.toString();

    embeds.permissions = base("🔑 Permissions")
      .setThumbnail(avatarUrl)
      .addFields(
        {
          name: `✅ Granted (${granted.length} / ${NOTABLE_PERMISSIONS.length})`,
          value: granted.length > 0 ? granted.map(([, label]) => label).join("\n") : "No notable permissions",
          inline: false,
        },
        { name: "🔢 Raw Permission Bitfield", value: `\`${rawPermBits}\``, inline: true },
        { name: "👑 Administrator", value: perms.has(PermissionsBitField.Flags.Administrator) ? "Yes" : "No", inline: true },
      );

    // ── ROLES ──
    const serverRoles = member.roles.cache
      .filter((r) => r.id !== guildId)
      .sort((a, b) => b.position - a.position);

    const roleLines = [...serverRoles.values()].map((r) => {
      const colorStr = r.hexColor !== "#000000" ? ` \`${r.hexColor.toUpperCase()}\`` : "";
      return `<@&${r.id}> \`${r.id}\`${colorStr}`;
    });

    // Discord field values cap at 1024 chars — build the list safely
    let roleValue = "";
    let roleCount = 0;
    for (const line of roleLines) {
      if ((roleValue + "\n" + line).length > 950) break;
      roleValue += (roleValue ? "\n" : "") + line;
      roleCount++;
    }
    if (roleCount < serverRoles.size) {
      roleValue += `\n*(+${serverRoles.size - roleCount} more)*`;
    }
    if (!roleValue) roleValue = "None";

    embeds.roles = base(`🎭 Roles (${serverRoles.size})`)
      .setThumbnail(avatarUrl)
      .addFields(
        { name: "🏆 Highest Role", value: serverRoles.first() ? `<@&${serverRoles.first()!.id}> (\`${serverRoles.first()!.id}\`)` : "None", inline: true },
        { name: "🎨 Display Color", value: member.displayHexColor !== "#000000" ? `\`${member.displayHexColor.toUpperCase()}\`` : "None", inline: true },
        { name: "📊 Total Roles", value: `${serverRoles.size}`, inline: true },
        { name: `🎭 All Roles`, value: roleValue || "None", inline: false },
      );
  }

  return embeds;
}

function buildNavButtons(msgId: string, hasMember: boolean, current: string): ActionRowBuilder<ButtonBuilder>[] {
  const cats1 = [
    { id: "home", label: "Overview", emoji: "🏠" },
    { id: "identity", label: "Identity", emoji: "🪪" },
    { id: "appearance", label: "Appearance", emoji: "🖼️" },
    { id: "badges", label: "Badges", emoji: "🏅" },
    { id: "technical", label: "Technical", emoji: "🔬" },
  ];
  const cats2 = [
    { id: "network", label: "Network", emoji: "🌐" },
    ...(hasMember
      ? [
          { id: "server", label: "Server", emoji: "🏠" },
          { id: "permissions", label: "Permissions", emoji: "🔑" },
          { id: "roles", label: "Roles", emoji: "🎭" },
        ]
      : []),
  ];

  function makeBtn(cat: { id: string; label: string; emoji: string }) {
    return new ButtonBuilder()
      .setCustomId(`user_cat_${msgId}_${cat.id}`)
      .setLabel(cat.label)
      .setEmoji(cat.emoji)
      .setStyle(current === cat.id ? ButtonStyle.Primary : ButtonStyle.Secondary);
  }

  const rows = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(cats1.map(makeBtn)),
  ];
  if (cats2.length > 0) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(cats2.map(makeBtn)));
  }
  return rows;
}

// ─── Discord Client ───────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// ─── Shop sessions ────────────────────────────────────────────────────────────
interface ShopSession { tier: CarTier; page: number; }
const shopCache = new Map<string, ShopSession>();
function scheduleShopCleanup(msgId: string) { setTimeout(() => shopCache.delete(msgId), 30 * 60 * 1000); }

function buildShopEmbed(tier: CarTier, page: number, footer: { text: string; iconURL: string }): EmbedBuilder {
  const pool = getCarsByTier(tier);
  const totalPages = Math.ceil(pool.length / CARS_PER_PAGE);
  const slice = pool.slice(page * CARS_PER_PAGE, page * CARS_PER_PAGE + CARS_PER_PAGE);
  const embed = new EmbedBuilder()
    .setColor(TIER_COLOR[tier])
    .setTitle(`🏪 Car Shop — ${TIER_EMOJI[tier]} ${tier}`)
    .setDescription(`Use \`-buy <name>\` or \`/buy car:<name>\` to purchase.\nPage **${page + 1}/${totalPages}** • ${pool.length} cars in this tier`)
    .setFooter(footer)
    .setTimestamp();
  for (const car of slice) {
    embed.addFields({ name: `${TIER_EMOJI[car.tier]} ${car.name}`, value: `Price: **${Economy.fmt(car.price)}**`, inline: false });
  }
  return embed;
}

function buildShopButtons(msgId: string, tier: CarTier, page: number): ActionRowBuilder<ButtonBuilder>[] {
  const pool = getCarsByTier(tier);
  const totalPages = Math.ceil(pool.length / CARS_PER_PAGE);

  const tierRow = new ActionRowBuilder<ButtonBuilder>();
  for (const t of ALL_TIERS) {
    tierRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`shop_tier_${msgId}_${t}`)
        .setLabel(`${TIER_EMOJI[t]} ${t}`)
        .setStyle(t === tier ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(t === tier),
    );
  }

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`shop_prev_${msgId}`).setLabel("◀ Prev").setStyle(ButtonStyle.Primary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`shop_next_${msgId}`).setLabel("Next ▶").setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1),
  );

  return [tierRow, navRow];
}

// ─── Garage sessions ───────────────────────────────────────────────────────────
interface GarageSession { ownerId: string; cars: string[]; }
const garageCache = new Map<string, GarageSession>();
function scheduleGarageCleanup(msgId: string) { setTimeout(() => garageCache.delete(msgId), 30 * 60 * 1000); }

const carImageCache = new Map<string, string>();
async function resolveCarImage(car: Car): Promise<string> {
  if (carImageCache.has(car.id)) return carImageCache.get(car.id)!;
  try {
    const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&titles=${encodeURIComponent(car.wikiTitle)}&pithumbsize=800&origin=*`;
    const resp = await fetch(apiUrl, { headers: { "User-Agent": "GTBP-Discord-Bot/1.0" } });
    if (resp.ok) {
      const data = await resp.json() as Record<string, any>;
      const pages = data?.query?.pages ?? {};
      const page = pages[Object.keys(pages)[0]];
      const url: string | undefined = page?.thumbnail?.source;
      if (url) { carImageCache.set(car.id, url); return url; }
    }
  } catch { }
  carImageCache.set(car.id, car.image);
  return car.image;
}

// ─── Car Customization ────────────────────────────────────────────────────────

interface CarColor { name: string; hex: number; emoji: string; searchTerm: string; }

const FERRARI_COLORS: CarColor[] = [
  { name: "Rosso Corsa",       hex: 0xcc0000, emoji: "🔴", searchTerm: "red" },
  { name: "Giallo Modena",     hex: 0xffd700, emoji: "🟡", searchTerm: "yellow" },
  { name: "Nero Daytona",      hex: 0x1a1a1a, emoji: "⬛", searchTerm: "black" },
  { name: "Bianco Avus",       hex: 0xf5f5f5, emoji: "⬜", searchTerm: "white" },
  { name: "Blu Tour de France",hex: 0x003399, emoji: "🔵", searchTerm: "blue" },
  { name: "Verde British",     hex: 0x004225, emoji: "🟢", searchTerm: "green" },
];
const LAMBORGHINI_COLORS: CarColor[] = [
  { name: "Arancio Borealis",  hex: 0xff6600, emoji: "🟠", searchTerm: "orange" },
  { name: "Verde Mantis",      hex: 0x6abf3c, emoji: "🟢", searchTerm: "green" },
  { name: "Nero Aldebaran",    hex: 0x1a1a1a, emoji: "⬛", searchTerm: "black" },
  { name: "Bianco Monocerus",  hex: 0xfafafa, emoji: "⬜", searchTerm: "white" },
  { name: "Blu Cepheus",       hex: 0x0033cc, emoji: "🔵", searchTerm: "blue" },
  { name: "Giallo Orion",      hex: 0xffd700, emoji: "🟡", searchTerm: "yellow" },
];
const BUGATTI_COLORS: CarColor[] = [
  { name: "French Racing Blue",hex: 0x0056a0, emoji: "🔵", searchTerm: "blue" },
  { name: "Noir Nocturne",     hex: 0x1a1a1a, emoji: "⬛", searchTerm: "black" },
  { name: "Blanc Antique",     hex: 0xfafafa, emoji: "⬜", searchTerm: "white" },
  { name: "Gris Aluminium",    hex: 0xa8a8a8, emoji: "🩶", searchTerm: "silver" },
  { name: "Rouge Dragon",      hex: 0xcc0000, emoji: "🔴", searchTerm: "red" },
  { name: "Or Blanc",          hex: 0xc9b035, emoji: "🟡", searchTerm: "gold" },
];
const PORSCHE_COLORS: CarColor[] = [
  { name: "Guards Red",        hex: 0xcc0000, emoji: "🔴", searchTerm: "red" },
  { name: "GT Silver",         hex: 0xa8a8a8, emoji: "🩶", searchTerm: "silver" },
  { name: "Jet Black",         hex: 0x1a1a1a, emoji: "⬛", searchTerm: "black" },
  { name: "Miami Blue",        hex: 0x009fdb, emoji: "🔵", searchTerm: "blue" },
  { name: "Chalk",             hex: 0xe8e0d0, emoji: "⬜", searchTerm: "white" },
  { name: "Python Green",      hex: 0x2d6000, emoji: "🟢", searchTerm: "green" },
];
const MCLAREN_COLORS: CarColor[] = [
  { name: "Papaya Orange",     hex: 0xff6e00, emoji: "🟠", searchTerm: "orange" },
  { name: "Onyx Black",        hex: 0x1a1a1a, emoji: "⬛", searchTerm: "black" },
  { name: "Silica White",      hex: 0xfafafa, emoji: "⬜", searchTerm: "white" },
  { name: "Lantana Purple",    hex: 0x9b59b6, emoji: "🟣", searchTerm: "purple" },
  { name: "Cerulean Blue",     hex: 0x0077be, emoji: "🔵", searchTerm: "blue" },
  { name: "Volcano Orange",    hex: 0xff4500, emoji: "🔴", searchTerm: "orange red" },
];
const PAGANI_COLORS: CarColor[] = [
  { name: "Argento Titanio",   hex: 0xa8a8a8, emoji: "🩶", searchTerm: "silver" },
  { name: "Nero",              hex: 0x1a1a1a, emoji: "⬛", searchTerm: "black" },
  { name: "Rosso",             hex: 0xcc0000, emoji: "🔴", searchTerm: "red" },
  { name: "Blu",               hex: 0x003399, emoji: "🔵", searchTerm: "blue" },
  { name: "Oro",               hex: 0xc9b035, emoji: "🟡", searchTerm: "gold" },
  { name: "Verde",             hex: 0x004225, emoji: "🟢", searchTerm: "green" },
];
const KOENIGSEGG_COLORS: CarColor[] = [
  { name: "Swedish Blue",      hex: 0x006ab7, emoji: "🔵", searchTerm: "blue" },
  { name: "Carbon Black",      hex: 0x1a1a1a, emoji: "⬛", searchTerm: "black" },
  { name: "Arctic White",      hex: 0xfafafa, emoji: "⬜", searchTerm: "white" },
  { name: "Candy Red",         hex: 0xcc0000, emoji: "🔴", searchTerm: "red" },
  { name: "Competition Yellow",hex: 0xffd700, emoji: "🟡", searchTerm: "yellow" },
  { name: "Emerald Green",     hex: 0x004225, emoji: "🟢", searchTerm: "green" },
];
const ASTON_COLORS: CarColor[] = [
  { name: "Racing Green",      hex: 0x004225, emoji: "🟢", searchTerm: "green" },
  { name: "Onyx Black",        hex: 0x1a1a1a, emoji: "⬛", searchTerm: "black" },
  { name: "Quantum Silver",    hex: 0xa8a8a8, emoji: "🩶", searchTerm: "silver" },
  { name: "Hyper Red",         hex: 0xcc0000, emoji: "🔴", searchTerm: "red" },
  { name: "Azure Blue",        hex: 0x003399, emoji: "🔵", searchTerm: "blue" },
  { name: "White Stone",       hex: 0xfafafa, emoji: "⬜", searchTerm: "white" },
];
const BENTLEY_COLORS: CarColor[] = [
  { name: "Beluga Black",      hex: 0x1a1a1a, emoji: "⬛", searchTerm: "black" },
  { name: "Ghost White",       hex: 0xfafafa, emoji: "⬜", searchTerm: "white" },
  { name: "Midnight Emerald",  hex: 0x004225, emoji: "🟢", searchTerm: "green" },
  { name: "Royal Ebony Blue",  hex: 0x003399, emoji: "🔵", searchTerm: "blue" },
  { name: "Dragon Red",        hex: 0xcc0000, emoji: "🔴", searchTerm: "red" },
  { name: "Glacier Silver",    hex: 0xa8a8a8, emoji: "🩶", searchTerm: "silver" },
];
const BMW_COLORS: CarColor[] = [
  { name: "Black Sapphire",    hex: 0x1a1a2e, emoji: "⬛", searchTerm: "black" },
  { name: "Alpine White",      hex: 0xfafafa, emoji: "⬜", searchTerm: "white" },
  { name: "Portimao Blue",     hex: 0x003399, emoji: "🔵", searchTerm: "blue" },
  { name: "Space Grey",        hex: 0x707070, emoji: "🩶", searchTerm: "grey" },
  { name: "Sao Paulo Yellow",  hex: 0xffd700, emoji: "🟡", searchTerm: "yellow" },
  { name: "Fire Orange",       hex: 0xff6600, emoji: "🟠", searchTerm: "orange" },
];
const MERCEDES_COLORS: CarColor[] = [
  { name: "Obsidian Black",    hex: 0x1a1a1a, emoji: "⬛", searchTerm: "black" },
  { name: "Polar White",       hex: 0xfafafa, emoji: "⬜", searchTerm: "white" },
  { name: "Brilliant Blue",    hex: 0x003399, emoji: "🔵", searchTerm: "blue" },
  { name: "Selenite Grey",     hex: 0xa8a8a8, emoji: "🩶", searchTerm: "silver" },
  { name: "Hyacinth Red",      hex: 0xcc0000, emoji: "🔴", searchTerm: "red" },
  { name: "Emerald Green",     hex: 0x004225, emoji: "🟢", searchTerm: "green" },
];
const JDM_COLORS: CarColor[] = [
  { name: "Midnight Purple",   hex: 0x4b0082, emoji: "🟣", searchTerm: "purple" },
  { name: "WR Blue Pearl",     hex: 0x1a52c4, emoji: "🔵", searchTerm: "blue" },
  { name: "Rally Red",         hex: 0xcc0000, emoji: "🔴", searchTerm: "red" },
  { name: "Sonic Silver",      hex: 0xa8a8a8, emoji: "🩶", searchTerm: "silver" },
  { name: "Crystal White",     hex: 0xfafafa, emoji: "⬜", searchTerm: "white" },
  { name: "Obsidian Black",    hex: 0x1a1a1a, emoji: "⬛", searchTerm: "black" },
];
const AMERICAN_COLORS: CarColor[] = [
  { name: "Race Red",          hex: 0xcc0000, emoji: "🔴", searchTerm: "red" },
  { name: "Oxford White",      hex: 0xfafafa, emoji: "⬜", searchTerm: "white" },
  { name: "Shadow Black",      hex: 0x1a1a1a, emoji: "⬛", searchTerm: "black" },
  { name: "Velocity Blue",     hex: 0x003399, emoji: "🔵", searchTerm: "blue" },
  { name: "Grabber Yellow",    hex: 0xffd700, emoji: "🟡", searchTerm: "yellow" },
  { name: "Eruption Green",    hex: 0x2d6000, emoji: "🟢", searchTerm: "green" },
];
const GENERIC_COLORS: CarColor[] = [
  { name: "Midnight Black",    hex: 0x1a1a1a, emoji: "⬛", searchTerm: "black" },
  { name: "Arctic White",      hex: 0xfafafa, emoji: "⬜", searchTerm: "white" },
  { name: "Racing Red",        hex: 0xcc0000, emoji: "🔴", searchTerm: "red" },
  { name: "Ocean Blue",        hex: 0x003399, emoji: "🔵", searchTerm: "blue" },
  { name: "Metallic Silver",   hex: 0xa8a8a8, emoji: "🩶", searchTerm: "silver" },
  { name: "Forest Green",      hex: 0x004225, emoji: "🟢", searchTerm: "green" },
];

function getManufacturerColors(car: Car): CarColor[] {
  const n = car.name.toLowerCase();
  if (n.startsWith("ferrari") || n.startsWith("laferrari")) return FERRARI_COLORS;
  if (n.startsWith("lamborghini")) return LAMBORGHINI_COLORS;
  if (n.startsWith("bugatti")) return BUGATTI_COLORS;
  if (n.startsWith("porsche")) return PORSCHE_COLORS;
  if (n.startsWith("mclaren")) return MCLAREN_COLORS;
  if (n.startsWith("pagani")) return PAGANI_COLORS;
  if (n.startsWith("koenigsegg")) return KOENIGSEGG_COLORS;
  if (n.startsWith("aston martin")) return ASTON_COLORS;
  if (n.startsWith("bentley") || n.startsWith("rolls-royce") || n.startsWith("rolls royce")) return BENTLEY_COLORS;
  if (n.startsWith("rimac") || n.startsWith("bmw")) return BMW_COLORS;
  if (n.startsWith("mercedes")) return MERCEDES_COLORS;
  if (n.startsWith("nissan") || n.startsWith("subaru") || n.startsWith("mitsubishi") || n.startsWith("toyota")) return JDM_COLORS;
  if (n.startsWith("ford") || n.startsWith("dodge") || n.startsWith("chevrolet") || n.startsWith("shelby")) return AMERICAN_COLORS;
  return GENERIC_COLORS;
}

const colorImageCache = new Map<string, string | null>();
async function resolveColorImage(car: Car, colorSearchTerm: string): Promise<string | null> {
  const cacheKey = `${car.id}_${colorSearchTerm}`;
  if (colorImageCache.has(cacheKey)) return colorImageCache.get(cacheKey)!;
  try {
    const query = encodeURIComponent(`${car.name} ${colorSearchTerm}`);
    const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=${query}&srnamespace=6&srlimit=5&origin=*`;
    const searchResp = await fetch(searchUrl, { headers: { "User-Agent": "GTBP-Discord-Bot/1.0" } });
    if (!searchResp.ok) { colorImageCache.set(cacheKey, null); return null; }
    const searchData = await searchResp.json() as Record<string, any>;
    const results: Array<{ title: string }> = searchData?.query?.search ?? [];
    for (const result of results) {
      const imgUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&titles=${encodeURIComponent(result.title)}&iiprop=url&iiurlwidth=800&origin=*`;
      const imgResp = await fetch(imgUrl, { headers: { "User-Agent": "GTBP-Discord-Bot/1.0" } });
      if (!imgResp.ok) continue;
      const imgData = await imgResp.json() as Record<string, any>;
      const pages = imgData?.query?.pages ?? {};
      const page = pages[Object.keys(pages)[0]];
      const thumbUrl: string | undefined = page?.imageinfo?.[0]?.thumburl;
      if (thumbUrl) { colorImageCache.set(cacheKey, thumbUrl); return thumbUrl; }
    }
  } catch { }
  colorImageCache.set(cacheKey, null);
  return null;
}

function buildCustomizeEmbed(
  car: Car,
  colors: CarColor[],
  custom: import("./economy").Customization,
  footer: { text: string; iconURL: string },
  imageUrl: string,
): EmbedBuilder {
  const currentColor = custom.colorName
    ? colors.find(c => c.name === custom.colorName) ?? null
    : null;
  const embedColor = currentColor ? currentColor.hex : (car.color as number);
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`✏️ Customize: ${car.name}`)
    .setDescription("Choose a paint color or set a custom license plate.\nIf a color-specific photo exists, it will be used automatically.")
    .addFields(
      { name: "🎨 Current Color", value: currentColor ? `${currentColor.emoji} ${currentColor.name}` : "Stock (Default)", inline: true },
      { name: "🔤 License Plate", value: custom.plate ? `\`${custom.plate}\`` : "None", inline: true },
    )
    .setImage(imageUrl)
    .setFooter(footer)
    .setTimestamp();
  return embed;
}

function buildColorButtons(msgId: string, car: Car, colors: CarColor[]): ActionRowBuilder<ButtonBuilder>[] {
  const carId = car.id;
  const row1 = new ActionRowBuilder<ButtonBuilder>();
  const row2 = new ActionRowBuilder<ButtonBuilder>();
  colors.slice(0, 5).forEach((c, i) =>
    row1.addComponents(new ButtonBuilder().setCustomId(`garage_setcolor_${msgId}_${carId}_${i}`).setLabel(`${c.emoji} ${c.name}`).setStyle(ButtonStyle.Secondary))
  );
  if (colors[5]) {
    row2.addComponents(new ButtonBuilder().setCustomId(`garage_setcolor_${msgId}_${carId}_5`).setLabel(`${colors[5].emoji} ${colors[5].name}`).setStyle(ButtonStyle.Secondary));
  }
  row2.addComponents(
    new ButtonBuilder().setCustomId(`garage_setplate_${msgId}_${carId}`).setLabel("🔤 Set Plate").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`garage_resetcolor_${msgId}_${carId}`).setLabel("🔄 Reset").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`garage_backtocar_${msgId}_${carId}`).setLabel("◀ Back to Car").setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2];
}

// ─── Garage Helpers ──────────────────────────────────────────────────────────

function buildGarageListEmbed(ownerId: string, ownerName: string, cars: string[], footer: { text: string; iconURL: string }): EmbedBuilder {
  const bal = Economy.getBalance(ownerId);
  const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle(`🚗 ${ownerName}'s Garage`).setFooter(footer).setTimestamp();
  if (cars.length === 0) {
    embed.setDescription(`No cars yet!\n**Balance:** ${Economy.fmt(bal)}\n\nHead to \`-shop\` to buy your first ride.`);
  } else {
    const list = cars.map(id => { const c = getCarById(id); return c ? `${TIER_EMOJI[c.tier]} **${c.name}**` : `❓ ${id}`; }).join("\n");
    embed.setDescription(`**Balance:** ${Economy.fmt(bal)} | **${cars.length}** car${cars.length !== 1 ? "s" : ""}\n\nClick a button to inspect a car:`).addFields({ name: "Collection", value: list, inline: false });
  }
  return embed;
}

function buildGarageCarButtons(msgId: string, cars: string[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < cars.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const id of cars.slice(i, i + 5)) {
      const c = getCarById(id);
      row.addComponents(new ButtonBuilder().setCustomId(`garage_car_${msgId}_${id}`).setLabel(c ? c.name.slice(0, 80) : id).setStyle(ButtonStyle.Primary));
    }
    rows.push(row);
  }
  return rows;
}

function buildGarageCarEmbed(
  car: Car,
  footer: { text: string; iconURL: string },
  imageUrl: string,
  custom?: import("./economy").Customization,
): EmbedBuilder {
  const sellPrice = Math.floor(car.price * 0.6);
  const colors = getManufacturerColors(car);
  const currentColor = custom?.colorName ? colors.find(c => c.name === custom.colorName) : undefined;
  const embedColor = currentColor ? currentColor.hex : (car.color as number);
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`${TIER_EMOJI[car.tier]} ${car.name}`)
    .addFields(
      { name: "🏆 Tier",       value: car.tier,                  inline: true },
      { name: "🌍 Origin",     value: car.origin,                inline: true },
      { name: "⚡ Horsepower", value: `${car.hp.toLocaleString()} hp`, inline: true },
      { name: "🏁 Top Speed",  value: `${car.topSpeed} mph`,     inline: true },
      { name: "💵 Buy Value",  value: Economy.fmt(car.price),    inline: true },
      { name: "💰 Sell Value", value: Economy.fmt(sellPrice),    inline: true },
    )
    .setImage(imageUrl)
    .setFooter(footer)
    .setTimestamp();
  if (currentColor) embed.addFields({ name: "🎨 Color", value: `${currentColor.emoji} ${currentColor.name}`, inline: true });
  if (custom?.plate) embed.addFields({ name: "🔤 Plate", value: `\`${custom.plate}\``, inline: true });
  return embed;
}

function buildGarageBackButton(msgId: string): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`garage_back_${msgId}`).setLabel("◀ Back to Garage").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setURL(`https://www.google.com/search?q=placeholder&tbm=isch`).setLabel("🔍 Google Images").setStyle(ButtonStyle.Link),
  );
  return [row];
}

function buildGarageCarNav(msgId: string, car: Car): ActionRowBuilder<ButtonBuilder>[] {
  const sellPrice = Math.floor(car.price * 0.6);
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`garage_back_${msgId}`).setLabel("◀ Back").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`garage_customize_${msgId}_${car.id}`).setLabel("✏️ Customize").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`garage_sell_${msgId}_${car.id}`).setLabel(`💰 Sell (${Economy.fmt(sellPrice)})`).setStyle(ButtonStyle.Danger),
  )];
}

function buildSellConfirmEmbed(car: Car, footer: { text: string; iconURL: string }, imageUrl: string): EmbedBuilder {
  const sellPrice = Math.floor(car.price * 0.6);
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`💰 Sell ${car.name}?`)
    .setDescription(`You will receive **${Economy.fmt(sellPrice)}**.\n*(60% of the ${Economy.fmt(car.price)} buy price)*\n\n⚠️ This cannot be undone.`)
    .setImage(imageUrl)
    .setFooter(footer)
    .setTimestamp();
}

function buildSellConfirmButtons(msgId: string, carId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`garage_confirm_sell_${msgId}_${carId}`).setLabel("✅ Yes, Sell It").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`garage_cancel_sell_${msgId}_${carId}`).setLabel("❌ Cancel").setStyle(ButtonStyle.Secondary),
  )];
}

// ─── Slash Command Definitions ────────────────────────────────────────────────
// integration_types: 0=GuildInstall 1=UserInstall  contexts: 0=Guild 1=BotDM 2=PrivateChannel

const SLASH_COMMANDS = [
  {
    name: "help",
    description: "Show all available commands",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "latency",
    description: "Check the bot's ping latency",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "say",
    description: "Make the bot send a message",
    options: [
      { name: "message", description: "What to say", type: ApplicationCommandOptionType.String, required: true },
    ],
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "user",
    description: "Show detailed info about any Discord user",
    options: [
      { name: "userid", description: "The user's ID (copy via Developer Mode)", type: ApplicationCommandOptionType.String, required: true },
    ],
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "ttt",
    description: "Challenge someone to Tic-Tac-Toe",
    options: [
      { name: "opponent", description: "Who to challenge", type: ApplicationCommandOptionType.User, required: true },
    ],
    integration_types: [0, 1],
    contexts: [0],
  },
  {
    name: "spam",
    description: `Send a message multiple times (max ${MAX_SPAM_COUNT})`,
    options: [
      { name: "count", description: "How many times", type: ApplicationCommandOptionType.Integer, required: true, min_value: 1, max_value: MAX_SPAM_COUNT },
      { name: "message", description: "What to spam", type: ApplicationCommandOptionType.String, required: true },
      { name: "channel", description: "Channel to send to (defaults to current)", type: ApplicationCommandOptionType.Channel, required: false },
    ],
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "ping",
    description: "Silently ping a user (ping then immediately delete the message)",
    options: [
      { name: "username", description: "Username or display name to search for", type: ApplicationCommandOptionType.String, required: true },
    ],
    integration_types: [0, 1],
    contexts: [0],
  },
  {
    name: "delete",
    description: "Bulk delete recent messages in this channel",
    options: [
      { name: "count", description: `How many messages to delete (max ${MAX_DELETE_COUNT})`, type: ApplicationCommandOptionType.Integer, required: true, min_value: 1, max_value: MAX_DELETE_COUNT },
      { name: "username", description: "Only delete messages from this user (optional)", type: ApplicationCommandOptionType.String, required: false },
    ],
    integration_types: [0, 1],
    contexts: [0],
  },
  {
    name: "ai",
    description: "Toggle the AI assistant on or off (owner only)",
    options: [
      {
        name: "toggle",
        description: "Turn AI on or off",
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [{ name: "on", value: "on" }, { name: "off", value: "off" }],
      },
    ],
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "perms",
    description: "Configure which roles can use which commands (owner only)",
    integration_types: [0],
    contexts: [0],
  },
  {
    name: "role",
    description: "Toggle a role on a user (owner only)",
    options: [
      { name: "user", description: "Username or mention to search for", type: ApplicationCommandOptionType.String, required: true },
      { name: "role", description: "Role name to toggle", type: ApplicationCommandOptionType.String, required: true },
    ],
    integration_types: [0],
    contexts: [0],
  },
  {
    name: "spamme",
    description: "Spam a message that looks like it came from you (via webhook)",
    options: [
      { name: "count", description: "How many times", type: ApplicationCommandOptionType.Integer, required: true, min_value: 1, max_value: MAX_SPAM_COUNT },
      { name: "message", description: "What to spam", type: ApplicationCommandOptionType.String, required: true },
      { name: "channel", description: "Channel to send to (defaults to current)", type: ApplicationCommandOptionType.Channel, required: false },
    ],
    integration_types: [0, 1],
    contexts: [0],
  },
  {
    name: "8ball",
    description: "Ask the magic 8-ball a question",
    options: [{ name: "question", description: "Your question", type: ApplicationCommandOptionType.String, required: true }],
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "rps",
    description: "Play rock paper scissors against the bot",
    options: [{
      name: "choice", description: "Your move", type: ApplicationCommandOptionType.String, required: true,
      choices: [{ name: "Rock 🪨", value: "rock" }, { name: "Paper 📄", value: "paper" }, { name: "Scissors ✂️", value: "scissors" }],
    }],
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "roll",
    description: "Roll dice — e.g. 2d6, 1d20 (default: 1d6)",
    options: [{ name: "dice", description: "Dice notation like 2d6 or 1d20", type: ApplicationCommandOptionType.String, required: false }],
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "flip",
    description: "Flip a coin",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "mock",
    description: "Convert text to mocking spongebob case",
    options: [{ name: "text", description: "Text to mock", type: ApplicationCommandOptionType.String, required: true }],
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "compliment",
    description: "Generate an AI compliment for someone",
    options: [{ name: "user", description: "Who to compliment", type: ApplicationCommandOptionType.User, required: true }],
    integration_types: [0, 1],
    contexts: [0],
  },
  {
    name: "snipe",
    description: "Show the last deleted message in this channel",
    integration_types: [0, 1],
    contexts: [0],
  },
  {
    name: "avatar",
    description: "Show someone's full-size profile picture",
    options: [{ name: "user", description: "Who to look up (defaults to you)", type: ApplicationCommandOptionType.User, required: false }],
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "dm",
    description: "Send a DM to a server member with a custom message",
    options: [
      { name: "user", description: "Who to DM (mention or username)", type: ApplicationCommandOptionType.User, required: true },
      { name: "message", description: "What to send them", type: ApplicationCommandOptionType.String, required: true },
      { name: "count", description: `How many copies to send (default 1, max ${MAX_DM_COUNT})`, type: ApplicationCommandOptionType.Integer, required: false, min_value: 1, max_value: MAX_DM_COUNT },
      { name: "ping", description: "Also ping them in this channel?", type: ApplicationCommandOptionType.Boolean, required: false },
    ],
    integration_types: [0, 1],
    contexts: [0],
  },
  // ── Economy ──────────────────────────────────────────────────────────────────
  {
    name: "balance",
    description: "Check your coin balance (or someone else's)",
    options: [{ name: "user", description: "Whose balance to check", type: ApplicationCommandOptionType.User, required: false }],
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "addmoney",
    description: "(Owner) Add coins to a user's wallet",
    options: [
      { name: "user", description: "Who to give coins to", type: ApplicationCommandOptionType.User, required: true },
      { name: "amount", description: "Amount to add", type: ApplicationCommandOptionType.Integer, required: true, min_value: 1 },
    ],
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "takemoney",
    description: "(Owner) Remove coins from a user's wallet",
    options: [
      { name: "user", description: "Who to take coins from", type: ApplicationCommandOptionType.User, required: true },
      { name: "amount", description: "Amount to remove", type: ApplicationCommandOptionType.Integer, required: true, min_value: 1 },
    ],
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "givemoney",
    description: "Transfer coins from your wallet to another user",
    options: [
      { name: "user", description: "Who to give coins to", type: ApplicationCommandOptionType.User, required: true },
      { name: "amount", description: "Amount to give", type: ApplicationCommandOptionType.Integer, required: true, min_value: 1 },
    ],
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "shop",
    description: "Browse the car shop",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "buy",
    description: "Purchase a car from the shop",
    options: [{ name: "car", description: "Name of the car to buy", type: ApplicationCommandOptionType.String, required: true }],
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "garage",
    description: "View your car collection",
    options: [{ name: "user", description: "Whose garage to view", type: ApplicationCommandOptionType.User, required: false }],
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
];

client.once(Events.ClientReady, async (readyClient) => {
  logger.info({ tag: readyClient.user.tag }, "Discord bot is online");
  try {
    const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN!);
    await rest.put(Routes.applicationCommands(readyClient.user.id), { body: SLASH_COMMANDS });
    logger.info("Slash commands registered globally");
  } catch (err) {
    logger.error({ err }, "Failed to register slash commands");
  }
});

// ─── Snipe: cache deleted messages ────────────────────────────────────────────

client.on(Events.MessageDelete, (message) => {
  if (message.author?.bot) return;
  if (!message.content) return;
  snipeCache.set(message.channelId, {
    content: message.content,
    authorName: message.member?.displayName ?? message.author?.username ?? "Unknown",
    authorAvatar: message.author?.displayAvatarURL() ?? "",
    deletedAt: new Date(),
  });
});

// ─── Interactions ─────────────────────────────────────────────────────────────

client.on(Events.InteractionCreate, async (interaction) => {
  const ownerId = process.env.DISCORD_OWNER_ID;

  // ── Slash Commands ───────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const slash = interaction as ChatInputCommandInteraction;
    const guildId = slash.guildId ?? "";
    const memberRoleIds =
      slash.guild && slash.member instanceof GuildMember
        ? [...slash.member.roles.cache.keys(), slash.guildId!]
        : [];
    const canUse = (cmd: string) =>
      slash.user.id === ownerId || hasPermission(guildId, memberRoleIds, cmd, slash.user.id);

    // /help
    if (slash.commandName === "help") {
      const inDM = !slash.guild;
      const footer = { text: `Requested by ${slash.user.username}`, iconURL: slash.user.displayAvatarURL() };
      const embeds = buildHelpEmbeds(inDM, footer);
      await slash.deferReply();
      const reply = await slash.editReply({ embeds: [embeds.home] });
      const msgId = reply.id;
      helpEmbedCache.set(msgId, { embeds, inDM, current: "home" });
      scheduleHelpCleanup(msgId);
      await slash.editReply({ embeds: [embeds.home], components: buildHelpNavButtons(msgId, inDM, "home") });
      return;
    }

    // /latency
    if (slash.commandName === "latency") {
      if (!canUse("latency")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      await slash.reply(`Pong! 🏓 **${client.ws.ping}ms**`);
      return;
    }

    // /say
    if (slash.commandName === "say") {
      if (!canUse("say")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const text = slash.options.getString("message", true);
      await slash.reply(text);
      return;
    }

    // /ai
    if (slash.commandName === "ai") {
      if (slash.user.id !== ownerId) { await slash.reply({ content: "Only the bot owner can toggle the AI assistant.", ephemeral: true }); return; }
      const sub = slash.options.getString("toggle", true);
      if (sub === "on") { aiEnabled = true; conversations.clear(); await slash.reply("AI assistant **enabled**. Mention me or reply to me to chat!"); }
      else { aiEnabled = false; conversations.clear(); await slash.reply("AI assistant **disabled**."); }
      return;
    }

    // /perms
    if (slash.commandName === "perms") {
      if (slash.user.id !== ownerId) { await slash.reply({ content: "Only the bot owner can manage permissions.", ephemeral: true }); return; }
      const guild = slash.guild;
      if (!guild) { await slash.reply({ content: "Server only command.", ephemeral: true }); return; }
      await guild.roles.fetch();
      await slash.reply({ content: `**Permission Manager** for **${guild.name}**\nConfigure by role or by individual member:`, components: [buildPermTabs("roles"), buildRoleSelect(guild)] });
      return;
    }

    // /role
    if (slash.commandName === "role") {
      if (slash.user.id !== ownerId) { await slash.reply({ content: "Only the bot owner can use this command.", ephemeral: true }); return; }
      if (!slash.guild) { await slash.reply({ content: "Server only command.", ephemeral: true }); return; }
      const userArg = slash.options.getString("user", true);
      const roleArg = slash.options.getString("role", true);
      // Reuse handleRoleCommand by constructing a fake args array
      // We create a proxy so handleRoleCommand can send replies via the interaction
      await slash.deferReply();
      try {
        // handleRoleCommand uses message.reply / message.channel.send — adapt output
        const guild = slash.guild;
        const query = userArg.replace(/[<@!>]/g, "").toLowerCase();
        const member =
          (await guild.members.fetch(query).catch(() => null)) ??
          guild.members.cache.find(
            (m) =>
              m.user.username.toLowerCase() === query ||
              m.displayName.toLowerCase() === query
          ) ??
          null;
        if (!member) { await slash.editReply(`❌ Could not find member **${userArg}**.`); return; }
        const roleQuery = roleArg.toLowerCase();
        const role = guild.roles.cache.find((r) => r.name.toLowerCase() === roleQuery || r.id === roleArg.replace(/[<@&>]/g, ""));
        if (!role) { await slash.editReply(`❌ Could not find role **${roleArg}**.`); return; }
        if (member.roles.cache.has(role.id)) {
          await member.roles.remove(role);
          await slash.editReply(`✅ Removed **${role.name}** from **${member.displayName}**.`);
        } else {
          await member.roles.add(role);
          await slash.editReply(`✅ Gave **${role.name}** to **${member.displayName}**.`);
        }
      } catch (err) {
        logger.error({ err }, "Slash role command error");
        await slash.editReply(`❌ Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    // /user
    if (slash.commandName === "user") {
      if (!canUse("user")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const rawId = slash.options.getString("userid", true).replace(/[<@!>]/g, "");
      if (!/^\d+$/.test(rawId)) { await slash.reply({ content: "❌ Please provide a valid numeric user ID.", ephemeral: true }); return; }
      await slash.deferReply();
      try {
        const user = await client.users.fetch(rawId, { force: true });
        const member = slash.guild
          ? await slash.guild.members.fetch({ user: rawId, force: true }).catch(() => null)
          : null;
        const footer = { text: `Requested by ${slash.user.username}`, iconURL: slash.user.displayAvatarURL() };
        const embeds = await buildUserEmbeds(user, member, guildId, footer);
        const hasMember = !!member;
        const reply = await slash.editReply({ embeds: [embeds.home] });
        const msgId = reply.id;
        userEmbedCache.set(msgId, { embeds, hasMember, current: "home" });
        scheduleCleanup(msgId);
        await slash.editReply({ embeds: [embeds.home], components: buildNavButtons(msgId, hasMember, "home") });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes("Unknown User") || errMsg.includes("10013")) {
          await slash.editReply(`❌ No Discord user found with ID \`${rawId}\`. Make sure you're using a user ID, not a username.`);
        } else {
          logger.error({ err }, "User embed build error (slash)");
          await slash.editReply(`❌ Found the user but failed to build the info panel: ${errMsg.slice(0, 200)}`);
        }
      }
      return;
    }

    // /ttt
    if (slash.commandName === "ttt") {
      if (!slash.guild) { await slash.reply({ content: "This command only works in servers.", ephemeral: true }); return; }
      if (!canUse("ttt")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const opponent = slash.options.getUser("opponent", true);
      if (opponent.id === slash.user.id) { await slash.reply({ content: "You can't play against yourself!", ephemeral: true }); return; }
      if (opponent.bot) { await slash.reply({ content: "You can't challenge a bot!", ephemeral: true }); return; }
      const board: Cell[] = Array(9).fill(null);
      const playerNames: [string, string] = [
        slash.member instanceof GuildMember ? slash.member.displayName : slash.user.username,
        slash.guild.members.cache.get(opponent.id)?.displayName ?? opponent.username,
      ];
      await slash.deferReply();
      const gameMsg = await slash.editReply({
        content: `❌ **${playerNames[0]}** vs ⭕ **${playerNames[1]}**\n❌ **${playerNames[0]}**'s turn`,
        components: buildTttComponents(board),
      });
      tttGames.set(gameMsg.id, { board, players: [slash.user.id, opponent.id], playerNames, currentTurn: 0 });
      setTimeout(() => {
        if (tttGames.has(gameMsg.id)) {
          tttGames.delete(gameMsg.id);
          slash.editReply({ content: "⏱️ Game expired.", components: [] }).catch(() => {});
        }
      }, 10 * 60 * 1000);
      return;
    }

    // /spam
    if (slash.commandName === "spam") {
      if (slash.guild && !canUse("spam")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const count = slash.options.getInteger("count", true);
      const spamText = slash.options.getString("message", true);
      const channelOpt = slash.options.getChannel("channel");
      const targetChannel = (channelOpt ? await client.channels.fetch(channelOpt.id).catch(() => null) : slash.channel) as TextChannel | null;
      if (!targetChannel || !("send" in targetChannel)) { await slash.reply({ content: "❌ Could not find that channel or it doesn't support messages.", ephemeral: true }); return; }
      await slash.deferReply({ ephemeral: true });
      for (let i = 0; i < count; i++) await targetChannel.send(spamText);
      await slash.editReply(`✅ Sent ${count} message${count !== 1 ? "s" : ""} to ${channelOpt ? `<#${channelOpt.id}>` : "this channel"}.`);
      return;
    }

    // /ping
    if (slash.commandName === "ping") {
      if (!slash.guild) { await slash.reply({ content: "This command only works in servers.", ephemeral: true }); return; }
      if (!canUse("ping")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const query = slash.options.getString("username", true);
      const results = await slash.guild.members.search({ query, limit: 5 }).catch(() => null);
      const memberFound =
        results?.find((m) => m.user.username.toLowerCase() === query.toLowerCase() || m.displayName.toLowerCase() === query.toLowerCase()) ??
        results?.first();
      if (!memberFound) { await slash.reply({ content: `Could not find **${query}**.`, ephemeral: true }); return; }
      await slash.deferReply({ ephemeral: true });
      const pingMsg = await (slash.channel as TextChannel).send(`${memberFound}`);
      await pingMsg.delete().catch(() => {});
      await slash.editReply(`✅ Pinged **${memberFound.displayName}**.`);
      return;
    }

    // /delete
    if (slash.commandName === "delete") {
      if (!slash.guild) { await slash.reply({ content: "This command only works in servers.", ephemeral: true }); return; }
      if (!canUse("delete")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const count = slash.options.getInteger("count", true);
      const targetUsername = slash.options.getString("username")?.toLowerCase() ?? null;
      const channel = slash.channel as TextChannel;
      await slash.deferReply({ ephemeral: true });
      try {
        if (targetUsername) {
          let deleted = 0, lastId: string | undefined;
          while (deleted < count) {
            const fetched: Collection<string, Message> = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
            if (!fetched.size) break;
            const matched = fetched.filter(
              (m) => m.author.username.toLowerCase() === targetUsername || (m.member?.displayName ?? "").toLowerCase() === targetUsername
            );
            const toDelete = [...matched.values()].slice(0, count - deleted);
            if (!toDelete.length) { const oldest = fetched.last(); if (oldest) lastId = oldest.id; else break; continue; }
            toDelete.length === 1 ? await toDelete[0].delete().catch(() => {}) : await channel.bulkDelete(toDelete, true).catch(() => {});
            deleted += toDelete.length;
            const oldest = fetched.last(); if (oldest) lastId = oldest.id; else break;
          }
          await slash.editReply(deleted ? `✅ Deleted ${deleted} message${deleted !== 1 ? "s" : ""} from **${targetUsername}**.` : `No recent messages found from **${targetUsername}**.`);
        } else {
          const fetched = await channel.messages.fetch({ limit: count });
          if (!fetched.size) { await slash.editReply("No messages to delete."); return; }
          fetched.size === 1 ? await fetched.first()!.delete().catch(() => {}) : await channel.bulkDelete(fetched, true).catch(() => {});
          await slash.editReply(`✅ Deleted ${fetched.size} message${fetched.size !== 1 ? "s" : ""}.`);
        }
      } catch (err) {
        logger.error({ err }, "Slash delete failed");
        await slash.editReply("Failed to delete. Ensure the bot has **Manage Messages** permission.").catch(() => {});
      }
      return;
    }

    // /spamme
    if (slash.commandName === "spamme") {
      if (!slash.guild) { await slash.reply({ content: "This command only works in servers.", ephemeral: true }); return; }
      if (!canUse("spamme")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const count = slash.options.getInteger("count", true);
      const text = slash.options.getString("message", true);
      const channelOpt = slash.options.getChannel("channel");
      const targetChannelId = channelOpt?.id ?? slash.channelId!;
      const member = slash.member instanceof GuildMember ? slash.member : null;
      const displayName = member?.displayName ?? slash.user.displayName ?? slash.user.username;
      const avatarUrl = member?.displayAvatarURL({ size: 256 }) ?? slash.user.displayAvatarURL({ size: 256 });
      const sessionId = `${slash.user.id}_${Date.now()}`;
      spamMeSessions.set(sessionId, { userId: slash.user.id, count, text, channelId: targetChannelId, guildId: slash.guildId, displayName, avatarUrl });
      setTimeout(() => spamMeSessions.delete(sessionId), 5 * 60 * 1000);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`spamme_confirm_${sessionId}`).setLabel(`Send ${count}× as me`).setStyle(ButtonStyle.Success).setEmoji("✅"),
        new ButtonBuilder().setCustomId(`spamme_cancel_${sessionId}`).setLabel("Cancel").setStyle(ButtonStyle.Danger).setEmoji("❌"),
      );
      await slash.reply({
        content: [
          `**Spam as you — confirmation**`,
          `You're about to send **"${text}"** × **${count}** time${count !== 1 ? "s" : ""} using your name and avatar${channelOpt ? ` in <#${channelOpt.id}>` : ""}.`,
          `The messages will appear to come from you via a webhook.`,
        ].join("\n"),
        components: [row],
        ephemeral: true,
      });
      return;
    }

    // /dm
    if (slash.commandName === "dm") {
      if (!slash.guild) { await slash.reply({ content: "This command only works in servers.", ephemeral: true }); return; }
      if (!canUse("dm")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const target = slash.options.getUser("user", true);
      const text = slash.options.getString("message", true);
      const count = slash.options.getInteger("count") ?? 1;
      const doPing = slash.options.getBoolean("ping") ?? false;
      await slash.deferReply({ ephemeral: true });
      try {
        for (let i = 0; i < count; i++) await target.send(text);
        if (doPing) await (slash.channel as TextChannel).send(`<@${target.id}>`).then(m => setTimeout(() => m.delete().catch(() => {}), 3000));
        await slash.editReply(`✅ Sent **${count}** DM${count !== 1 ? "s" : ""} to **${target.username}**.${doPing ? " Pinged them too." : ""}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await slash.editReply(
          errMsg.includes("Cannot send messages") || errMsg.includes("50007")
            ? `❌ Couldn't DM **${target.username}** — they likely have DMs turned off or have the bot blocked.`
            : `❌ Failed: ${errMsg.slice(0, 200)}`
        );
      }
      return;
    }

    // /8ball
    if (slash.commandName === "8ball") {
      if (!canUse("8ball")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const question = slash.options.getString("question", true);
      const answer = EIGHT_BALL_RESPONSES[Math.floor(Math.random() * EIGHT_BALL_RESPONSES.length)];
      await slash.reply(`🎱 **${question}**\n${answer}`);
      return;
    }

    // /rps
    if (slash.commandName === "rps") {
      if (!canUse("rps")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const player = slash.options.getString("choice", true) as RpsMove;
      const bot = RPS_MOVES[Math.floor(Math.random() * 3)];
      const result = rpsResult(player, bot);
      const lines = [`You: ${RPS_EMOJI[player]} **${player}** vs Bot: ${RPS_EMOJI[bot]} **${bot}**`];
      if (result === "win") lines.push("🎉 You win!");
      else if (result === "lose") lines.push("😔 You lose!");
      else lines.push("🤝 It's a draw!");
      await slash.reply(lines.join("\n"));
      return;
    }

    // /roll
    if (slash.commandName === "roll") {
      if (!canUse("roll")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const input = slash.options.getString("dice") ?? "1d6";
      const match = input.match(/^(\d+)d(\d+)$/i);
      if (!match) { await slash.reply({ content: "❌ Use dice notation like `2d6` or `1d20`.", ephemeral: true }); return; }
      const num = Math.min(parseInt(match[1], 10), 20);
      const sides = Math.min(parseInt(match[2], 10), 1000);
      if (num < 1 || sides < 2) { await slash.reply({ content: "❌ Need at least 1 die with 2+ sides.", ephemeral: true }); return; }
      const rolls = Array.from({ length: num }, () => Math.floor(Math.random() * sides) + 1);
      const total = rolls.reduce((a, b) => a + b, 0);
      await slash.reply(`🎲 Rolling **${num}d${sides}**: [${rolls.join(", ")}] = **${total}**`);
      return;
    }

    // /flip
    if (slash.commandName === "flip") {
      if (!canUse("flip")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      await slash.reply(Math.random() < 0.5 ? "🪙 **Heads!**" : "🪙 **Tails!**");
      return;
    }

    // /mock
    if (slash.commandName === "mock") {
      if (!canUse("mock")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      await slash.reply(mockText(slash.options.getString("text", true)));
      return;
    }

    // /compliment
    if (slash.commandName === "compliment") {
      if (!canUse("compliment")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const target = slash.options.getUser("user", true);
      await slash.deferReply();
      try {
        const resp = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          max_tokens: 150,
          messages: [
            { role: "system", content: "Generate a warm, genuine, and creative compliment for someone. Keep it 1-3 sentences, friendly and uplifting. Do not start with 'Hey' or their name." },
            { role: "user", content: `Write a compliment for ${target.displayName ?? target.username}.` },
          ],
        });
        const compliment = resp.choices[0]?.message?.content ?? "You're awesome!";
        await slash.editReply(`💌 **${target.displayName ?? target.username}**: ${compliment}`);
      } catch { await slash.editReply("❌ Couldn't generate a compliment right now."); }
      return;
    }

    // /snipe
    if (slash.commandName === "snipe") {
      if (!slash.guild) { await slash.reply({ content: "Server only.", ephemeral: true }); return; }
      if (!canUse("snipe")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const entry = snipeCache.get(slash.channelId!);
      if (!entry) { await slash.reply({ content: "Nothing to snipe — no deleted messages cached for this channel.", ephemeral: true }); return; }
      const embed = new EmbedBuilder()
        .setColor(0xff4444)
        .setAuthor({ name: entry.authorName, iconURL: entry.authorAvatar })
        .setDescription(entry.content)
        .setFooter({ text: `Deleted ${formatAge(entry.deletedAt)} ago` });
      await slash.reply({ embeds: [embed] });
      return;
    }

    // /avatar
    if (slash.commandName === "avatar") {
      if (!canUse("avatar")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const target = slash.options.getUser("user") ?? slash.user;
      const avatarUrl = target.displayAvatarURL({ size: 4096 });
      const embed = new EmbedBuilder()
        .setColor(target.accentColor ?? 0x5865f2)
        .setAuthor({ name: target.username, iconURL: avatarUrl })
        .setTitle(`${target.displayName ?? target.username}'s Avatar`)
        .setImage(avatarUrl)
        .addFields(
          { name: "PNG", value: `[Link](${target.displayAvatarURL({ size: 4096, extension: "png" })})`, inline: true },
          { name: "WebP", value: `[Link](${target.displayAvatarURL({ size: 4096, extension: "webp" })})`, inline: true },
          ...(target.avatar?.startsWith("a_") ? [{ name: "GIF", value: `[Link](${target.displayAvatarURL({ size: 4096, extension: "gif" })})`, inline: true }] : []),
        );
      await slash.reply({ embeds: [embed] });
      return;
    }

    // ── Economy ──────────────────────────────────────────────────────────────

    if (slash.commandName === "balance") {
      if (!canUse("balance")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const target = slash.options.getUser("user") ?? slash.user;
      const bal = Economy.getBalance(target.id);
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
        .setTitle("💰 Wallet")
        .addFields({ name: "Balance", value: Economy.fmt(bal), inline: false })
        .setTimestamp();
      await slash.reply({ embeds: [embed] });
      return;
    }

    if (slash.commandName === "addmoney") {
      if (slash.user.id !== ownerId) { await slash.reply({ content: "Only the bot owner can add money.", ephemeral: true }); return; }
      const target = slash.options.getUser("user", true);
      const amount = slash.options.getInteger("amount", true);
      const newBal = Economy.addBalance(target.id, amount);
      await slash.reply({ content: `✅ Added **${Economy.fmt(amount)}** to **${target.username}**'s wallet.\nNew balance: **${Economy.fmt(newBal)}**` });
      return;
    }

    if (slash.commandName === "takemoney") {
      if (slash.user.id !== ownerId) { await slash.reply({ content: "Only the bot owner can remove money.", ephemeral: true }); return; }
      const target = slash.options.getUser("user", true);
      const amount = slash.options.getInteger("amount", true);
      const newBal = Economy.addBalance(target.id, -amount);
      await slash.reply({ content: `✅ Removed **${Economy.fmt(amount)}** from **${target.username}**'s wallet.\nNew balance: **${Economy.fmt(newBal)}**` });
      return;
    }

    if (slash.commandName === "givemoney") {
      if (!canUse("givemoney")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const target = slash.options.getUser("user", true);
      const amount = slash.options.getInteger("amount", true);
      if (target.id === slash.user.id) { await slash.reply({ content: "You can't give money to yourself.", ephemeral: true }); return; }
      const bal = Economy.getBalance(slash.user.id);
      if (bal < amount) { await slash.reply({ content: `❌ You only have **${Economy.fmt(bal)}** — not enough to give **${Economy.fmt(amount)}**.`, ephemeral: true }); return; }
      Economy.addBalance(slash.user.id, -amount);
      const newBal = Economy.addBalance(target.id, amount);
      await slash.reply({ content: `✅ Transferred **${Economy.fmt(amount)}** to **${target.username}**!\nTheir new balance: **${Economy.fmt(newBal)}**` });
      return;
    }

    if (slash.commandName === "shop") {
      if (!canUse("shop")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const footer = { text: `Requested by ${slash.user.username}`, iconURL: slash.user.displayAvatarURL() };
      await slash.deferReply();
      const reply = await slash.editReply({ embeds: [buildShopEmbed("Budget", 0, footer)] });
      const msgId = reply.id;
      shopCache.set(msgId, { tier: "Budget", page: 0 });
      scheduleShopCleanup(msgId);
      await slash.editReply({ embeds: [buildShopEmbed("Budget", 0, footer)], components: buildShopButtons(msgId, "Budget", 0) });
      return;
    }

    if (slash.commandName === "buy") {
      if (!canUse("buy")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const carQuery = slash.options.getString("car", true);
      const car = findCarByName(carQuery);
      if (!car) { await slash.reply({ content: `❌ Car not found. Use \`/shop\` to browse available cars.`, ephemeral: true }); return; }
      if (Economy.hasCar(slash.user.id, car.id)) { await slash.reply({ content: `You already own the **${car.name}**! View it with \`/garage\`.`, ephemeral: true }); return; }
      const bal = Economy.getBalance(slash.user.id);
      if (bal < car.price) { await slash.reply({ content: `❌ Not enough cash! **${car.name}** costs **${Economy.fmt(car.price)}** and you only have **${Economy.fmt(bal)}**.`, ephemeral: true }); return; }
      Economy.addCar(slash.user.id, car.id, car.price);
      const embed = new EmbedBuilder()
        .setColor(car.color)
        .setTitle("🎉 Purchase Successful!")
        .setDescription(`You just bought the **${TIER_EMOJI[car.tier]} ${car.name}**!\nRemaining balance: **${Economy.fmt(Economy.getBalance(slash.user.id))}**`)
        .setImage(car.image)
        .setTimestamp();
      await slash.reply({ embeds: [embed] });
      return;
    }

    if (slash.commandName === "garage") {
      if (!canUse("garage")) { await slash.reply({ content: "You don't have permission to use that command.", ephemeral: true }); return; }
      const target = slash.options.getUser("user") ?? slash.user;
      const cars = Economy.getCars(target.id);
      const footer = { text: `Requested by ${slash.user.username}`, iconURL: slash.user.displayAvatarURL() };
      const embed = buildGarageListEmbed(target.id, target.username, cars, footer);
      if (cars.length === 0) { await slash.reply({ embeds: [embed] }); return; }
      await slash.deferReply();
      const reply = await slash.editReply({ embeds: [embed] });
      const msgId = reply.id;
      garageCache.set(msgId, { ownerId: target.id, cars });
      scheduleGarageCleanup(msgId);
      await slash.editReply({ embeds: [embed], components: buildGarageCarButtons(msgId, cars) });
      return;
    }

    return; // unknown slash command
  }

  // Tic-Tac-Toe
  if (interaction.isButton() && interaction.customId.startsWith("ttt_")) {
    const btn = interaction as ButtonInteraction;
    const game = tttGames.get(btn.message.id);
    if (!game) { await btn.reply({ content: "This game is no longer active.", ephemeral: true }); return; }
    if (btn.user.id !== game.players[game.currentTurn]) { await btn.reply({ content: "It's not your turn!", ephemeral: true }); return; }
    const idx = parseInt(btn.customId.split("_")[1], 10);
    if (game.board[idx] !== null) { await btn.reply({ content: "That cell is already taken.", ephemeral: true }); return; }
    game.board[idx] = game.currentTurn === 0 ? "X" : "O";
    const winner = checkWinner(game.board);
    const isDraw = !winner && game.board.every((c) => c !== null);
    if (winner || isDraw) {
      await btn.update({ content: buildTttStatus(game, winner ? "win" : "draw"), components: buildTttComponents(game.board, true) });
      tttGames.delete(btn.message.id);
      return;
    }
    game.currentTurn = game.currentTurn === 0 ? 1 : 0;
    await btn.update({ content: buildTttStatus(game), components: buildTttComponents(game.board) });
    return;
  }

  // User info navigation
  if (interaction.isButton() && interaction.customId.startsWith("user_cat_")) {
    const btn = interaction as ButtonInteraction;
    const parts = btn.customId.split("_"); // ["user","cat","MSGID","CATEGORY"]
    const msgId = parts[2];
    const category = parts[3];
    const session = userEmbedCache.get(msgId);
    if (!session) { await btn.reply({ content: "This info panel has expired. Run `-user` again.", ephemeral: true }); return; }
    const embed = session.embeds[category];
    if (!embed) { await btn.reply({ content: "Category not found.", ephemeral: true }); return; }
    session.current = category;
    await btn.update({ embeds: [embed], components: buildNavButtons(msgId, session.hasMember, category) });
    return;
  }

  // Help navigation
  if (interaction.isButton() && interaction.customId.startsWith("help_cat_")) {
    const btn = interaction as ButtonInteraction;
    const parts = btn.customId.split("_"); // ["help","cat","MSGID","CATEGORY"]
    const msgId = parts[2];
    const category = parts.slice(3).join("_"); // safe even if category had underscores
    const session = helpEmbedCache.get(msgId);
    if (!session) { await btn.reply({ content: "This help panel has expired. Run the command again.", ephemeral: true }); return; }
    const embed = session.embeds[category];
    if (!embed) { await btn.reply({ content: "Category not found.", ephemeral: true }); return; }
    session.current = category;
    await btn.update({ embeds: [embed], components: buildHelpNavButtons(msgId, session.inDM, category) });
    return;
  }

  // Shop tier-jump buttons
  if (interaction.isButton() && interaction.customId.startsWith("shop_tier_")) {
    const btn = interaction as ButtonInteraction;
    const parts = btn.customId.split("_");
    const msgId = parts[2];
    const tier = parts.slice(3).join("_") as CarTier;
    const session = shopCache.get(msgId);
    if (!session) { await btn.reply({ content: "This shop panel has expired. Run the command again.", ephemeral: true }); return; }
    const footer = { text: `Requested by ${btn.user.username}`, iconURL: btn.user.displayAvatarURL() };
    session.tier = tier;
    session.page = 0;
    await btn.update({ embeds: [buildShopEmbed(tier, 0, footer)], components: buildShopButtons(msgId, tier, 0) });
    return;
  }

  // Shop prev/next navigation
  if (interaction.isButton() && (interaction.customId.startsWith("shop_prev_") || interaction.customId.startsWith("shop_next_"))) {
    const btn = interaction as ButtonInteraction;
    const isNext = btn.customId.startsWith("shop_next_");
    const msgId = btn.customId.replace(isNext ? "shop_next_" : "shop_prev_", "");
    const session = shopCache.get(msgId);
    if (!session) { await btn.reply({ content: "This shop panel has expired. Run the command again.", ephemeral: true }); return; }
    const footer = { text: `Requested by ${btn.user.username}`, iconURL: btn.user.displayAvatarURL() };
    const pool = getCarsByTier(session.tier);
    const totalPages = Math.ceil(pool.length / CARS_PER_PAGE);
    session.page = Math.max(0, Math.min(session.page + (isNext ? 1 : -1), totalPages - 1));
    await btn.update({ embeds: [buildShopEmbed(session.tier, session.page, footer)], components: buildShopButtons(msgId, session.tier, session.page) });
    return;
  }

  // Garage: view a car
  if (interaction.isButton() && interaction.customId.startsWith("garage_car_")) {
    const btn = interaction as ButtonInteraction;
    const withoutPrefix = btn.customId.slice("garage_car_".length);
    const underscoreIdx = withoutPrefix.indexOf("_");
    const msgId = withoutPrefix.slice(0, underscoreIdx);
    const carId = withoutPrefix.slice(underscoreIdx + 1);
    const session = garageCache.get(msgId);
    if (!session) { await btn.reply({ content: "This garage session has expired. Run the command again.", ephemeral: true }); return; }
    const car = getCarById(carId);
    if (!car) { await btn.reply({ content: "Car not found.", ephemeral: true }); return; }
    await btn.deferUpdate();
    const footer = { text: `${btn.user.username}'s Garage`, iconURL: btn.user.displayAvatarURL() };
    const custom = Economy.getCustomization(session.ownerId, carId);
    const imageUrl = custom.imageUrl ?? await resolveCarImage(car);
    await btn.editReply({ embeds: [buildGarageCarEmbed(car, footer, imageUrl, custom)], components: buildGarageCarNav(msgId, car) });
    return;
  }

  // Garage: back to list
  if (interaction.isButton() && interaction.customId.startsWith("garage_back_")) {
    const btn = interaction as ButtonInteraction;
    const msgId = btn.customId.slice("garage_back_".length);
    const session = garageCache.get(msgId);
    if (!session) { await btn.reply({ content: "This garage session has expired. Run the command again.", ephemeral: true }); return; }
    const footer = { text: `${btn.user.username}'s Garage`, iconURL: btn.user.displayAvatarURL() };
    const ownerUser = await client.users.fetch(session.ownerId).catch(() => btn.user);
    await btn.update({
      embeds: [buildGarageListEmbed(session.ownerId, ownerUser.username, session.cars, footer)],
      components: buildGarageCarButtons(msgId, session.cars),
    });
    return;
  }

  // Garage: sell — show confirmation
  if (interaction.isButton() && interaction.customId.startsWith("garage_sell_")) {
    const btn = interaction as ButtonInteraction;
    const withoutPrefix = btn.customId.slice("garage_sell_".length);
    const firstUnderscore = withoutPrefix.indexOf("_");
    const msgId = withoutPrefix.slice(0, firstUnderscore);
    const carId = withoutPrefix.slice(firstUnderscore + 1);
    const session = garageCache.get(msgId);
    if (!session) { await btn.reply({ content: "This garage session has expired. Run the command again.", ephemeral: true }); return; }
    if (session.ownerId !== btn.user.id) { await btn.reply({ content: "You can only sell cars from your own garage.", ephemeral: true }); return; }
    const car = getCarById(carId);
    if (!car) { await btn.reply({ content: "Car not found.", ephemeral: true }); return; }
    if (!Economy.hasCar(btn.user.id, carId)) { await btn.reply({ content: "You don't own that car.", ephemeral: true }); return; }
    await btn.deferUpdate();
    const footer = { text: `${btn.user.username}'s Garage`, iconURL: btn.user.displayAvatarURL() };
    const imageUrl = await resolveCarImage(car);
    await btn.editReply({ embeds: [buildSellConfirmEmbed(car, footer, imageUrl)], components: buildSellConfirmButtons(msgId, carId) });
    return;
  }

  // Garage: sell — confirmed
  if (interaction.isButton() && interaction.customId.startsWith("garage_confirm_sell_")) {
    const btn = interaction as ButtonInteraction;
    const withoutPrefix = btn.customId.slice("garage_confirm_sell_".length);
    const firstUnderscore = withoutPrefix.indexOf("_");
    const msgId = withoutPrefix.slice(0, firstUnderscore);
    const carId = withoutPrefix.slice(firstUnderscore + 1);
    const session = garageCache.get(msgId);
    if (!session) { await btn.reply({ content: "This garage session has expired. Run the command again.", ephemeral: true }); return; }
    if (session.ownerId !== btn.user.id) { await btn.reply({ content: "You can only sell cars from your own garage.", ephemeral: true }); return; }
    const car = getCarById(carId);
    if (!car) { await btn.reply({ content: "Car not found.", ephemeral: true }); return; }
    if (!Economy.hasCar(btn.user.id, carId)) { await btn.reply({ content: "You no longer own that car.", ephemeral: true }); return; }
    const sellPrice = Math.floor(car.price * 0.6);
    Economy.removeCar(btn.user.id, carId);
    const newBal = Economy.addBalance(btn.user.id, sellPrice);
    session.cars = session.cars.filter(id => id !== carId);
    const footer = { text: `${btn.user.username}'s Garage`, iconURL: btn.user.displayAvatarURL() };
    const successEmbed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("✅ Car Sold!")
      .setDescription(`You sold your **${TIER_EMOJI[car.tier]} ${car.name}** for **${Economy.fmt(sellPrice)}**.\n\nNew balance: **${Economy.fmt(newBal)}**`)
      .setFooter(footer)
      .setTimestamp();
    const ownerUser = await client.users.fetch(session.ownerId).catch(() => btn.user);
    await btn.update({
      embeds: [successEmbed],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`garage_back_${msgId}`).setLabel("◀ Back to Garage").setStyle(ButtonStyle.Secondary),
      )],
    });
    return;
  }

  // Garage: sell — cancelled
  if (interaction.isButton() && interaction.customId.startsWith("garage_cancel_sell_")) {
    const btn = interaction as ButtonInteraction;
    const withoutPrefix = btn.customId.slice("garage_cancel_sell_".length);
    const firstUnderscore = withoutPrefix.indexOf("_");
    const msgId = withoutPrefix.slice(0, firstUnderscore);
    const carId = withoutPrefix.slice(firstUnderscore + 1);
    const session = garageCache.get(msgId);
    if (!session) { await btn.reply({ content: "This garage session has expired.", ephemeral: true }); return; }
    const car = getCarById(carId);
    if (!car) { await btn.reply({ content: "Car not found.", ephemeral: true }); return; }
    await btn.deferUpdate();
    const footer = { text: `${btn.user.username}'s Garage`, iconURL: btn.user.displayAvatarURL() };
    const custom = Economy.getCustomization(btn.user.id, carId);
    const imageUrl = custom.imageUrl ?? await resolveCarImage(car);
    await btn.editReply({ embeds: [buildGarageCarEmbed(car, footer, imageUrl, custom)], components: buildGarageCarNav(msgId, car) });
    return;
  }

  // Garage: open customize view
  if (interaction.isButton() && interaction.customId.startsWith("garage_customize_")) {
    const btn = interaction as ButtonInteraction;
    const withoutPrefix = btn.customId.slice("garage_customize_".length);
    const firstUnderscore = withoutPrefix.indexOf("_");
    const msgId = withoutPrefix.slice(0, firstUnderscore);
    const carId = withoutPrefix.slice(firstUnderscore + 1);
    const session = garageCache.get(msgId);
    if (!session) { await btn.reply({ content: "This garage session has expired. Run the command again.", ephemeral: true }); return; }
    if (session.ownerId !== btn.user.id) { await btn.reply({ content: "You can only customize your own cars.", ephemeral: true }); return; }
    const car = getCarById(carId);
    if (!car) { await btn.reply({ content: "Car not found.", ephemeral: true }); return; }
    await btn.deferUpdate();
    const footer = { text: `${btn.user.username}'s Garage`, iconURL: btn.user.displayAvatarURL() };
    const custom = Economy.getCustomization(btn.user.id, carId);
    const imageUrl = custom.imageUrl ?? await resolveCarImage(car);
    const colors = getManufacturerColors(car);
    await btn.editReply({ embeds: [buildCustomizeEmbed(car, colors, custom, footer, imageUrl)], components: buildColorButtons(msgId, car, colors) });
    return;
  }

  // Garage: set color
  if (interaction.isButton() && interaction.customId.startsWith("garage_setcolor_")) {
    const btn = interaction as ButtonInteraction;
    const withoutPrefix = btn.customId.slice("garage_setcolor_".length);
    const parts = withoutPrefix.split("_");
    const msgId = parts[0];
    const colorIdx = parseInt(parts[parts.length - 1], 10);
    const carId = parts.slice(1, parts.length - 1).join("_");
    const session = garageCache.get(msgId);
    if (!session) { await btn.reply({ content: "This garage session has expired. Run the command again.", ephemeral: true }); return; }
    if (session.ownerId !== btn.user.id) { await btn.reply({ content: "You can only customize your own cars.", ephemeral: true }); return; }
    const car = getCarById(carId);
    if (!car) { await btn.reply({ content: "Car not found.", ephemeral: true }); return; }
    const colors = getManufacturerColors(car);
    const chosen = colors[colorIdx];
    if (!chosen) { await btn.reply({ content: "Invalid color.", ephemeral: true }); return; }
    await btn.deferUpdate();
    const footer = { text: `${btn.user.username}'s Garage`, iconURL: btn.user.displayAvatarURL() };
    const colorImage = await resolveColorImage(car, chosen.searchTerm);
    const imageUrl = colorImage ?? await resolveCarImage(car);
    Economy.setCustomization(btn.user.id, carId, { colorName: chosen.name, colorHex: chosen.hex, imageUrl: colorImage ?? undefined });
    const custom = Economy.getCustomization(btn.user.id, carId);
    await btn.editReply({ embeds: [buildGarageCarEmbed(car, footer, imageUrl, custom)], components: buildGarageCarNav(msgId, car) });
    return;
  }

  // Garage: reset color
  if (interaction.isButton() && interaction.customId.startsWith("garage_resetcolor_")) {
    const btn = interaction as ButtonInteraction;
    const withoutPrefix = btn.customId.slice("garage_resetcolor_".length);
    const firstUnderscore = withoutPrefix.indexOf("_");
    const msgId = withoutPrefix.slice(0, firstUnderscore);
    const carId = withoutPrefix.slice(firstUnderscore + 1);
    const session = garageCache.get(msgId);
    if (!session) { await btn.reply({ content: "This garage session has expired. Run the command again.", ephemeral: true }); return; }
    if (session.ownerId !== btn.user.id) { await btn.reply({ content: "You can only customize your own cars.", ephemeral: true }); return; }
    const car = getCarById(carId);
    if (!car) { await btn.reply({ content: "Car not found.", ephemeral: true }); return; }
    await btn.deferUpdate();
    const footer = { text: `${btn.user.username}'s Garage`, iconURL: btn.user.displayAvatarURL() };
    const existing = Economy.getCustomization(btn.user.id, carId);
    Economy.setCustomization(btn.user.id, carId, { colorName: undefined, colorHex: undefined, imageUrl: undefined, plate: existing.plate });
    const custom = Economy.getCustomization(btn.user.id, carId);
    const imageUrl = await resolveCarImage(car);
    const colors = getManufacturerColors(car);
    await btn.editReply({ embeds: [buildCustomizeEmbed(car, colors, custom, footer, imageUrl)], components: buildColorButtons(msgId, car, colors) });
    return;
  }

  // Garage: back to car view from customize
  if (interaction.isButton() && interaction.customId.startsWith("garage_backtocar_")) {
    const btn = interaction as ButtonInteraction;
    const withoutPrefix = btn.customId.slice("garage_backtocar_".length);
    const firstUnderscore = withoutPrefix.indexOf("_");
    const msgId = withoutPrefix.slice(0, firstUnderscore);
    const carId = withoutPrefix.slice(firstUnderscore + 1);
    const session = garageCache.get(msgId);
    if (!session) { await btn.reply({ content: "This garage session has expired. Run the command again.", ephemeral: true }); return; }
    const car = getCarById(carId);
    if (!car) { await btn.reply({ content: "Car not found.", ephemeral: true }); return; }
    await btn.deferUpdate();
    const footer = { text: `${btn.user.username}'s Garage`, iconURL: btn.user.displayAvatarURL() };
    const custom = Economy.getCustomization(session.ownerId, carId);
    const imageUrl = custom.imageUrl ?? await resolveCarImage(car);
    await btn.editReply({ embeds: [buildGarageCarEmbed(car, footer, imageUrl, custom)], components: buildGarageCarNav(msgId, car) });
    return;
  }

  // Garage: set license plate — show modal
  if (interaction.isButton() && interaction.customId.startsWith("garage_setplate_")) {
    const btn = interaction as ButtonInteraction;
    const withoutPrefix = btn.customId.slice("garage_setplate_".length);
    const firstUnderscore = withoutPrefix.indexOf("_");
    const msgId = withoutPrefix.slice(0, firstUnderscore);
    const carId = withoutPrefix.slice(firstUnderscore + 1);
    const session = garageCache.get(msgId);
    if (!session) { await btn.reply({ content: "This garage session has expired. Run the command again.", ephemeral: true }); return; }
    if (session.ownerId !== btn.user.id) { await btn.reply({ content: "You can only customize your own cars.", ephemeral: true }); return; }
    const existing = Economy.getCustomization(btn.user.id, carId);
    const modal = new ModalBuilder()
      .setCustomId(`garage_plate_modal_${msgId}_${carId}`)
      .setTitle("Custom License Plate");
    const plateInput = new TextInputBuilder()
      .setCustomId("plate_text")
      .setLabel("Enter plate (max 8 characters)")
      .setStyle(TextInputStyle.Short)
      .setMaxLength(8)
      .setMinLength(1)
      .setRequired(true);
    if (existing.plate) plateInput.setValue(existing.plate);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(plateInput));
    await btn.showModal(modal);
    return;
  }

  // Garage: plate modal submitted
  if (interaction.isModalSubmit() && interaction.customId.startsWith("garage_plate_modal_")) {
    const modal = interaction as ModalSubmitInteraction;
    const withoutPrefix = modal.customId.slice("garage_plate_modal_".length);
    const firstUnderscore = withoutPrefix.indexOf("_");
    const msgId = withoutPrefix.slice(0, firstUnderscore);
    const carId = withoutPrefix.slice(firstUnderscore + 1);
    const plate = modal.fields.getTextInputValue("plate_text").toUpperCase().replace(/[^A-Z0-9 \-]/g, "").slice(0, 8);
    const session = garageCache.get(msgId);
    if (!session || session.ownerId !== modal.user.id) { await modal.reply({ content: "Session expired or not your garage.", ephemeral: true }); return; }
    const car = getCarById(carId);
    if (!car) { await modal.reply({ content: "Car not found.", ephemeral: true }); return; }
    await modal.deferUpdate();
    Economy.setCustomization(modal.user.id, carId, { plate });
    const footer = { text: `${modal.user.username}'s Garage`, iconURL: modal.user.displayAvatarURL() };
    const custom = Economy.getCustomization(modal.user.id, carId);
    const imageUrl = custom.imageUrl ?? await resolveCarImage(car);
    const colors = getManufacturerColors(car);
    await modal.editReply({ embeds: [buildCustomizeEmbed(car, colors, custom, footer, imageUrl)], components: buildColorButtons(msgId, car, colors) });
    return;
  }

  // Perms: role select
  if (interaction.isRoleSelectMenu() && interaction.customId === "perm_role_select") {
    const sel = interaction as RoleSelectMenuInteraction;
    if (sel.user.id !== ownerId) { await sel.reply({ content: "Only the bot owner can configure permissions.", ephemeral: true }); return; }
    const guild = sel.guild;
    if (!guild) return;
    const roleId = sel.values[0];
    const roleName = roleId === guild.id ? "@everyone" : (guild.roles.cache.get(roleId)?.name ?? sel.roles.first()?.name ?? roleId);
    await sel.update({
      content: [`**Permissions for role: ${roleName}** in **${guild.name}**`, `Green ✅ = allowed  ·  Red ❌ = denied`, `*(All commands are owner-only by default.)*`].join("\n"),
      components: buildCommandButtons(guild.id, roleId),
    });
    return;
  }

  // Perms: member select
  if (interaction.isUserSelectMenu() && interaction.customId === "perm_user_select") {
    const sel = interaction as UserSelectMenuInteraction;
    if (sel.user.id !== ownerId) { await sel.reply({ content: "Only the bot owner can configure permissions.", ephemeral: true }); return; }
    const guild = sel.guild;
    if (!guild) return;
    const userId = sel.values[0];
    const member = sel.members?.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
    const displayName = (member as GuildMember | null)?.displayName ?? sel.users?.get(userId)?.username ?? userId;
    await sel.update({
      content: [`**Permissions for member: ${displayName}** in **${guild.name}**`, `Green ✅ = allowed  ·  Red ❌ = denied`, `*(Member overrides stack on top of role permissions.)*`].join("\n"),
      components: buildMemberCommandButtons(guild.id, userId),
    });
    return;
  }

  // Perms: toggle role  (customId: perm_toggle_{roleId}_{page}_{cmd})
  if (interaction.isButton() && interaction.customId.startsWith("perm_toggle_")) {
    const btn = interaction as ButtonInteraction;
    if (btn.user.id !== ownerId) { await btn.reply({ content: "Only the bot owner can configure permissions.", ephemeral: true }); return; }
    const guild = btn.guild;
    if (!guild) return;
    const parts = btn.customId.split("_");
    const roleId = parts[2];
    const page = parseInt(parts[3], 10);
    const command = parts[4];
    const nowAllowed = toggleRolePerm(guild.id, roleId, command);
    const roleName = roleId === guild.id ? "@everyone" : (guild.roles.cache.get(roleId)?.name ?? roleId);
    await btn.update({
      content: [`**Permissions for role: ${roleName}** in **${guild.name}**`, `Green ✅ = allowed  ·  Red ❌ = denied`, `*(Toggled **${COMMAND_LABELS[command]}** → ${nowAllowed ? "✅ allowed" : "❌ denied"})*`].join("\n"),
      components: buildCommandButtons(guild.id, roleId, page),
    });
    return;
  }

  // Perms: toggle member  (customId: perm_usertoggle_{userId}_{page}_{cmd})
  if (interaction.isButton() && interaction.customId.startsWith("perm_usertoggle_")) {
    const btn = interaction as ButtonInteraction;
    if (btn.user.id !== ownerId) { await btn.reply({ content: "Only the bot owner can configure permissions.", ephemeral: true }); return; }
    const guild = btn.guild;
    if (!guild) return;
    const withoutPrefix = btn.customId.slice("perm_usertoggle_".length);
    const parts = withoutPrefix.split("_"); // [userId, page, cmd]
    const userId = parts[0];
    const page = parseInt(parts[1], 10);
    const command = parts[2];
    const nowAllowed = toggleUserPerm(guild.id, userId, command);
    const member = await guild.members.fetch(userId).catch(() => null);
    const displayName = member?.displayName ?? userId;
    await btn.update({
      content: [`**Permissions for member: ${displayName}** in **${guild.name}**`, `Green ✅ = allowed  ·  Red ❌ = denied`, `*(Toggled **${COMMAND_LABELS[command]}** → ${nowAllowed ? "✅ allowed" : "❌ denied"})*`].join("\n"),
      components: buildMemberCommandButtons(guild.id, userId, page),
    });
    return;
  }

  // Perms: role page navigation
  if (interaction.isButton() && interaction.customId.startsWith("perm_rolepage_")) {
    const btn = interaction as ButtonInteraction;
    if (btn.user.id !== ownerId) { await btn.reply({ content: "Only the bot owner can configure permissions.", ephemeral: true }); return; }
    const guild = btn.guild;
    if (!guild) return;
    const withoutPrefix = btn.customId.slice("perm_rolepage_".length);
    const lastUnderscore = withoutPrefix.lastIndexOf("_");
    const roleId = withoutPrefix.slice(0, lastUnderscore);
    const page = parseInt(withoutPrefix.slice(lastUnderscore + 1), 10);
    const roleName = roleId === guild.id ? "@everyone" : (guild.roles.cache.get(roleId)?.name ?? roleId);
    await btn.update({
      content: [`**Permissions for role: ${roleName}** in **${guild.name}**`, `Green ✅ = allowed  ·  Red ❌ = denied`].join("\n"),
      components: buildCommandButtons(guild.id, roleId, page),
    });
    return;
  }

  // Perms: member page navigation
  if (interaction.isButton() && interaction.customId.startsWith("perm_memberpage_")) {
    const btn = interaction as ButtonInteraction;
    if (btn.user.id !== ownerId) { await btn.reply({ content: "Only the bot owner can configure permissions.", ephemeral: true }); return; }
    const guild = btn.guild;
    if (!guild) return;
    const withoutPrefix = btn.customId.slice("perm_memberpage_".length);
    const lastUnderscore = withoutPrefix.lastIndexOf("_");
    const userId = withoutPrefix.slice(0, lastUnderscore);
    const page = parseInt(withoutPrefix.slice(lastUnderscore + 1), 10);
    const member = await guild.members.fetch(userId).catch(() => null);
    const displayName = member?.displayName ?? userId;
    await btn.update({
      content: [`**Permissions for member: ${displayName}** in **${guild.name}**`, `Green ✅ = allowed  ·  Red ❌ = denied`].join("\n"),
      components: buildMemberCommandButtons(guild.id, userId, page),
    });
    return;
  }

  // Perms: tab — roles
  if (interaction.isButton() && interaction.customId === "perm_tab_roles") {
    const btn = interaction as ButtonInteraction;
    if (btn.user.id !== ownerId) { await btn.reply({ content: "Only the bot owner can configure permissions.", ephemeral: true }); return; }
    const guild = btn.guild;
    if (!guild) return;
    await guild.roles.fetch();
    await btn.update({ content: `**Permission Manager** for **${guild.name}**\nConfigure by role or by individual member:`, components: [buildPermTabs("roles"), buildRoleSelect(guild)] });
    return;
  }

  // Perms: tab — members
  if (interaction.isButton() && interaction.customId === "perm_tab_members") {
    const btn = interaction as ButtonInteraction;
    if (btn.user.id !== ownerId) { await btn.reply({ content: "Only the bot owner can configure permissions.", ephemeral: true }); return; }
    const guild = btn.guild;
    if (!guild) return;
    await btn.update({ content: `**Permission Manager** for **${guild.name}**\nPick a member to configure their individual command access:`, components: [buildPermTabs("members"), buildUserSelect()] });
    return;
  }

  // Perms: back (from role command list)
  if (interaction.isButton() && interaction.customId === "perm_back") {
    const btn = interaction as ButtonInteraction;
    if (btn.user.id !== ownerId) { await btn.reply({ content: "Only the bot owner can configure permissions.", ephemeral: true }); return; }
    const guild = btn.guild;
    if (!guild) return;
    await guild.roles.fetch();
    await btn.update({ content: `**Permission Manager** for **${guild.name}**\nConfigure by role or by individual member:`, components: [buildPermTabs("roles"), buildRoleSelect(guild)] });
    return;
  }

  // Perms: back (from member command list)
  if (interaction.isButton() && interaction.customId === "perm_back_members") {
    const btn = interaction as ButtonInteraction;
    if (btn.user.id !== ownerId) { await btn.reply({ content: "Only the bot owner can configure permissions.", ephemeral: true }); return; }
    const guild = btn.guild;
    if (!guild) return;
    await btn.update({ content: `**Permission Manager** for **${guild.name}**\nPick a member to configure their individual command access:`, components: [buildPermTabs("members"), buildUserSelect()] });
    return;
  }

  // SpamMe: confirm / cancel
  if (interaction.isButton() && (interaction.customId.startsWith("spamme_confirm_") || interaction.customId.startsWith("spamme_cancel_"))) {
    const btn = interaction as ButtonInteraction;
    // Session ID is "userId_timestamp" — must grab everything after the second underscore
    const isConfirm = btn.customId.startsWith("spamme_confirm_");
    const sessionId = btn.customId.split("_").slice(2).join("_");
    const session = spamMeSessions.get(sessionId);

    if (!session) {
      await btn.reply({ content: "⏱️ This confirmation expired. Run the command again.", ephemeral: true });
      return;
    }
    if (btn.user.id !== session.userId) {
      await btn.reply({ content: "This confirmation isn't for you.", ephemeral: true });
      return;
    }
    spamMeSessions.delete(sessionId);

    if (!isConfirm) {
      await btn.deferUpdate();
      await btn.editReply({ content: "❌ Cancelled.", components: [] });
      return;
    }

    // Confirm — deferUpdate acknowledges the click and lets us edit the confirmation message
    await btn.deferUpdate();
    await btn.editReply({ content: `⏳ Sending **${session.count}** message${session.count !== 1 ? "s" : ""} as **${session.displayName}**...`, components: [] });
    try {
      // Fetch channel from client cache (works when button is clicked from DM too)
      const channel = (client.channels.cache.get(session.channelId) ?? await client.channels.fetch(session.channelId).catch(() => null)) as TextChannel | null;
      if (!channel) { await btn.editReply("❌ Could not find the original channel."); return; }
      await sendViaWebhook(channel, session.displayName, session.avatarUrl, session.text, session.count);
      await btn.editReply(`✅ Sent **${session.count}** message${session.count !== 1 ? "s" : ""} as **${session.displayName}**.`);
    } catch (err) {
      logger.error({ err }, "SpamMe webhook error");
      const errMsg = err instanceof Error ? err.message : String(err);
      const isPerms = errMsg.includes("Missing Permissions") || errMsg.includes("Missing Access");
      await btn.editReply(
        isPerms
          ? "❌ **Missing Permissions** — a server admin needs to give the bot the **Manage Webhooks** permission in this channel (or server-wide via its role)."
          : `❌ Failed: ${errMsg.slice(0, 200)}`
      );
    }
    return;
  }
});

// ─── AI helper ────────────────────────────────────────────────────────────────

async function runAI(userText: string, userId: string, message: Message) {
  if (!conversations.has(userId)) conversations.set(userId, []);
  const history = conversations.get(userId)!;
  history.push({ role: "user", content: userText });
  if (history.length > 20) history.splice(0, history.length - 20);

  await (message.channel as TextChannel).sendTyping();

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 1024,
    messages: [
      {
        role: "system",
        content: [
          "You are a helpful, friendly assistant in a Discord server. Keep replies concise and conversational.",
          message.guild
            ? "You can also manage Discord roles. If the user asks you to give, add, remove, or change a role for someone, use the manage_role function."
            : "",
        ].filter(Boolean).join(" "),
      },
      ...history,
    ],
    tools: message.guild ? [ROLE_TOOL] : undefined,
    tool_choice: message.guild ? "auto" : undefined,
  } as Parameters<typeof groq.chat.completions.create>[0]);

  const choice = response.choices[0];

  // AI wants to execute a role change
  if (choice?.finish_reason === "tool_calls" && (choice.message as any).tool_calls?.length) {
    const call = (choice.message as any).tool_calls[0];
    if (call.function.name === "manage_role") {
      try {
        const args = JSON.parse(call.function.arguments);
        await handleRoleCommand([args.user_query, args.role_query], message);
        history.push({ role: "assistant", content: `[Executed role change for ${args.user_query}]` });
      } catch {
        await message.reply("I tried to change the role but something went wrong.");
      }
      return;
    }
  }

  const reply = choice?.message?.content ?? "Sorry, I couldn't think of a response.";
  history.push({ role: "assistant", content: reply });
  await message.reply(reply);
}

// ─── Messages ─────────────────────────────────────────────────────────────────

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;
  const ownerId = process.env.DISCORD_OWNER_ID;

  // AI: @mention
  if (aiEnabled && client.user && message.mentions.has(client.user)) {
    const userText = message.content.replace(/<@!?\d+>/g, "").trim();
    if (!userText) { await message.reply("Hey! How can I help?"); return; }
    try { await runAI(userText, message.author.id, message); } catch (err) { logger.error({ err }, "AI error"); await message.reply("Sorry, I ran into an error."); }
    return;
  }

  // AI: reply chain
  if (aiEnabled && message.reference?.messageId) {
    const referenced = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    if (referenced?.author.id === client.user?.id) {
      const userText = message.content.trim();
      if (!userText) return;
      try { await runAI(userText, message.author.id, message); } catch (err) { logger.error({ err }, "AI reply error"); }
      return;
    }
  }

  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();
  const guildId = message.guildId ?? "";
  const memberRoleIds = message.guild ? [...(message.member?.roles.cache.keys() ?? []), message.guildId!] : [];
  const canUse = (cmd: string) => message.author.id === ownerId || hasPermission(guildId, memberRoleIds, cmd, message.author.id);

  // -lock / -unlock (owner only)
  if (command === "lock") {
    if (message.author.id !== ownerId) { await message.channel.send("Only the bot owner can use that."); return; }
    botLocked = true;
    await message.channel.send("🔒 Bot locked. All commands are disabled for everyone.");
    return;
  }
  if (command === "unlock") {
    if (message.author.id !== ownerId) { await message.channel.send("Only the bot owner can use that."); return; }
    botLocked = false;
    await message.channel.send("🔓 Bot unlocked. Commands are enabled again.");
    return;
  }

  // Block all commands while locked (owner bypasses)
  if (botLocked && message.author.id !== ownerId) {
    await message.channel.send("🔒 The bot is currently locked. Commands are disabled.");
    return;
  }

  // -help
  if (command === "help") {
    const inDM = !message.guild;
    const footer = { text: `Requested by ${message.author.username}`, iconURL: message.author.displayAvatarURL() };
    const embeds = buildHelpEmbeds(inDM, footer);
    const sent = await message.channel.send({ embeds: [embeds.home] });
    const msgId = sent.id;
    helpEmbedCache.set(msgId, { embeds, inDM, current: "home" });
    scheduleHelpCleanup(msgId);
    await sent.edit({ embeds: [embeds.home], components: buildHelpNavButtons(msgId, inDM, "home") });
    return;
  }

  if (command === "latency") {
    if (!canUse("latency")) { await message.channel.send("You don't have permission to use that command."); return; }
    await message.channel.send(`Pong! 🏓 **${client.ws.ping}ms**`);
    return;
  }

  if (command === "say") {
    if (!canUse("say")) { await message.channel.send("You don't have permission to use that command."); return; }
    if (!args.length) { await message.channel.send("Usage: `-say <message>`"); return; }
    await message.channel.send(args.join(" "));
    return;
  }

  if (command === "ai") {
    if (message.author.id !== ownerId) { await message.channel.send("Only the bot owner can toggle the AI assistant."); return; }
    const sub = args[0]?.toLowerCase();
    if (sub === "on") { aiEnabled = true; conversations.clear(); await message.channel.send("AI assistant **enabled**. Mention me or reply to me to chat!"); }
    else if (sub === "off") { aiEnabled = false; conversations.clear(); await message.channel.send("AI assistant **disabled**."); }
    else { await message.channel.send(`AI is currently **${aiEnabled ? "enabled" : "disabled"}**. Use \`-ai on\` or \`-ai off\`.`); }
    return;
  }

  if (command === "perms") {
    if (message.author.id !== ownerId) { await message.channel.send("Only the bot owner can manage permissions."); return; }
    const guild = message.guild;
    if (!guild) { await message.channel.send("Server only command."); return; }
    await guild.roles.fetch();
    await message.channel.send({ content: `**Permission Manager** for **${guild.name}**\nConfigure by role or by individual member:`, components: [buildPermTabs("roles"), buildRoleSelect(guild)] });
    return;
  }

  if (command === "role") {
    await handleRoleCommand(args, message);
    return;
  }

  // -user (paginated OSINT embed)
  if (command === "user") {
    if (!canUse("user")) { await message.channel.send("You don't have permission to use that command."); return; }
    const rawId = args[0]?.replace(/[<@!>]/g, "");
    if (!rawId || !/^\d+$/.test(rawId)) { await message.channel.send("Usage: `-user <userid>`"); return; }

    const fetchMsg = await message.channel.send("⏳ Fetching user information...");
    try {
      const user = await client.users.fetch(rawId, { force: true });
      const member = message.guild
        ? await message.guild.members.fetch({ user: rawId, force: true }).catch(() => null)
        : null;

      const footer = {
        text: `Requested by ${message.author.username}`,
        iconURL: message.author.displayAvatarURL(),
      };

      const embeds = await buildUserEmbeds(user, member, guildId, footer);
      const hasMember = !!member;

      // Send the overview first, then cache with message ID, then add buttons
      await fetchMsg.edit({ content: null, embeds: [embeds.home] });
      const msgId = fetchMsg.id;
      userEmbedCache.set(msgId, { embeds, hasMember, current: "home" });
      scheduleCleanup(msgId);
      await fetchMsg.edit({ embeds: [embeds.home], components: buildNavButtons(msgId, hasMember, "home") });
    } catch (err) {
      logger.error({ err }, "Failed to fetch user info");
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("Unknown User") || errMsg.includes("10013")) {
        await fetchMsg.edit(`❌ No Discord user found with ID \`${args[0]}\`. Make sure you're using a user ID, not a username.`);
      } else {
        logger.error({ err }, "User embed build error");
        await fetchMsg.edit(`❌ Found the user but failed to build the info panel: ${errMsg.slice(0, 200)}`);
      }
    }
    return;
  }

  if (command === "ttt") {
    if (!canUse("ttt")) { await message.channel.send("You don't have permission to use that command."); return; }
    const opponent = message.mentions.users.first();
    if (!opponent) { await message.channel.send("Usage: `-ttt @user`"); return; }
    if (opponent.id === message.author.id) { await message.channel.send("You can't play against yourself!"); return; }
    if (opponent.bot) { await message.channel.send("You can't challenge a bot!"); return; }
    const board: Cell[] = Array(9).fill(null);
    const playerNames: [string, string] = [
      message.member?.displayName ?? message.author.username,
      message.guild?.members.cache.get(opponent.id)?.displayName ?? opponent.username,
    ];
    const gameMsg = await message.channel.send({
      content: `❌ **${playerNames[0]}** vs ⭕ **${playerNames[1]}**\n❌ **${playerNames[0]}**'s turn`,
      components: buildTttComponents(board),
    });
    tttGames.set(gameMsg.id, { board, players: [message.author.id, opponent.id], playerNames, currentTurn: 0 });
    setTimeout(() => {
      if (tttGames.has(gameMsg.id)) {
        tttGames.delete(gameMsg.id);
        gameMsg.edit({ content: "⏱️ Game expired.", components: [] }).catch(() => {});
      }
    }, 10 * 60 * 1000);
    return;
  }

  if (command === "spam") {
    if (!canUse("spam")) { await message.channel.send("You don't have permission to use that command."); return; }
    if (args.length < 2) { await message.channel.send("Usage: `-spam <count> [#channel] <message>`"); return; }
    const count = parseInt(args[0], 10);
    if (isNaN(count) || count < 1 || count > MAX_SPAM_COUNT) { await message.channel.send(`Count must be 1–${MAX_SPAM_COUNT}.`); return; }
    // Optional channel mention as second arg
    let spamArgs = args.slice(1);
    let targetSpamChannel: TextChannel = message.channel as TextChannel;
    if (spamArgs[0]?.startsWith("<#") && spamArgs[0].endsWith(">")) {
      const chanId = spamArgs[0].replace(/[<#>]/g, "");
      const resolved = await client.channels.fetch(chanId).catch(() => null) as TextChannel | null;
      if (!resolved || !("send" in resolved)) { await message.channel.send("❌ Couldn't find that channel."); return; }
      targetSpamChannel = resolved;
      spamArgs = spamArgs.slice(1);
    }
    if (!spamArgs.length) { await message.channel.send("Usage: `-spam <count> [#channel] <message>`"); return; }
    const spamText = spamArgs.join(" ");
    await message.delete().catch(() => {});
    for (let i = 0; i < count; i++) await targetSpamChannel.send(spamText);
    return;
  }

  if (command === "ping") {
    if (!canUse("ping")) { await message.channel.send("You don't have permission to use that command."); return; }
    if (!args.length) { await message.channel.send("Usage: `-ping <username>`"); return; }
    const query = args.join(" ");
    const guild = message.guild;
    if (!guild) { await message.channel.send("Server only."); return; }
    const results = await guild.members.search({ query, limit: 5 }).catch(() => null);
    const memberFound =
      results?.find((m) => m.user.username.toLowerCase() === query.toLowerCase() || m.displayName.toLowerCase() === query.toLowerCase()) ??
      results?.first();
    if (!memberFound) { await message.channel.send(`Could not find **${query}**.`); return; }
    await message.delete().catch(() => {});
    const pingMsg = await message.channel.send(`${memberFound}`);
    await pingMsg.delete().catch(() => {});
    return;
  }

  if (command === "delete") {
    if (!canUse("delete")) { await message.channel.send("You don't have permission to use that command."); return; }
    if (!args.length) { await message.channel.send("Usage: `-delete <count> [username]`"); return; }
    const count = parseInt(args[0], 10);
    if (isNaN(count) || count < 1 || count > MAX_DELETE_COUNT) { await message.channel.send(`Count must be 1–${MAX_DELETE_COUNT}.`); return; }
    const targetUsername = args[1]?.toLowerCase() ?? null;
    const channel = message.channel as TextChannel;
    await message.delete().catch(() => {});
    try {
      if (targetUsername) {
        let deleted = 0, lastId: string | undefined;
        while (deleted < count) {
          const fetched: Collection<string, Message> = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
          if (!fetched.size) break;
          const matched = fetched.filter((m) => m.author.username.toLowerCase() === targetUsername || (m.member?.displayName ?? "").toLowerCase() === targetUsername);
          const toDelete = [...matched.values()].slice(0, count - deleted);
          if (!toDelete.length) { const oldest = fetched.last(); if (oldest) lastId = oldest.id; else break; continue; }
          toDelete.length === 1 ? await toDelete[0].delete().catch(() => {}) : await channel.bulkDelete(toDelete, true).catch(() => {});
          deleted += toDelete.length;
          const oldest = fetched.last(); if (oldest) lastId = oldest.id; else break;
        }
        if (!deleted) await channel.send(`No recent messages found from **${args[1]}**.`);
      } else {
        const fetched = await channel.messages.fetch({ limit: count });
        if (!fetched.size) { await channel.send("No messages to delete."); return; }
        fetched.size === 1 ? await fetched.first()!.delete().catch(() => {}) : await channel.bulkDelete(fetched, true).catch(() => {});
      }
    } catch (err) {
      logger.error({ err }, "Delete failed");
      await channel.send("Failed to delete. Ensure the bot has **Manage Messages** permission.").catch(() => {});
    }
    return;
  }

  if (command === "spamme") {
    if (!canUse("spamme")) { await message.channel.send("You don't have permission to use that command."); return; }
    const guild = message.guild;
    if (!guild) { await message.channel.send("Server only command."); return; }
    if (args.length < 2) { await message.channel.send("Usage: `-spamme <count> <message>`"); return; }
    const count = parseInt(args[0], 10);
    if (isNaN(count) || count < 1 || count > MAX_SPAM_COUNT) { await message.channel.send(`Count must be 1–${MAX_SPAM_COUNT}.`); return; }
    const text = args.slice(1).join(" ");
    const member = message.member;
    const displayName = member?.displayName ?? message.author.username;
    const avatarUrl = member?.displayAvatarURL({ size: 256 }) ?? message.author.displayAvatarURL({ size: 256 });
    const sessionId = `${message.author.id}_${Date.now()}`;
    spamMeSessions.set(sessionId, { userId: message.author.id, count, text, channelId: message.channelId, guildId: message.guildId, displayName, avatarUrl });
    setTimeout(() => spamMeSessions.delete(sessionId), 5 * 60 * 1000);
    await message.delete().catch(() => {});
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`spamme_confirm_${sessionId}`).setLabel(`Send ${count}× as me`).setStyle(ButtonStyle.Success).setEmoji("✅"),
      new ButtonBuilder().setCustomId(`spamme_cancel_${sessionId}`).setLabel("Cancel").setStyle(ButtonStyle.Danger).setEmoji("❌"),
    );
    // DM the confirmation so only the user sees it (prefix commands can't be ephemeral)
    try {
      const dm = await message.author.createDM();
      await dm.send({
        content: [
          `**Spam as you — confirmation**`,
          `You're about to send **"${text}"** × **${count}** time${count !== 1 ? "s" : ""} in <#${message.channelId}> using your display name and avatar.`,
          `The messages will appear to come from you via a webhook.`,
        ].join("\n"),
        components: [row],
      });
    } catch {
      // User has DMs closed — fall back to a short-lived channel message
      const notice = await (message.channel as TextChannel).send({
        content: [
          `<@${message.author.id}> Couldn't DM you (your DMs may be closed). Use \`/spamme\` for a private confirmation, or open your DMs and run the command again.`,
        ].join("\n"),
      });
      setTimeout(() => notice.delete().catch(() => {}), 10_000);
    }
    return;
  }

  if (command === "dm") {
    if (!canUse("dm")) { await message.channel.send("You don't have permission to use that command."); return; }
    if (!message.guild) { await message.channel.send("Server only command."); return; }
    // Usage: -dm <@user|username> [--ping] <message>
    if (!args.length) { await message.channel.send(`Usage: \`-dm <@user or username> [count] <message>\` — add \`--ping\` to also ping them. Count up to ${MAX_DM_COUNT}.`); return; }
    const doPing = args.includes("--ping");
    const cleanArgs = args.filter(a => a !== "--ping");
    if (cleanArgs.length < 2) { await message.channel.send(`Usage: \`-dm <@user or username> [count] <message>\``); return; }
    const userArg = cleanArgs[0].replace(/[<@!>]/g, "");
    // Optional count as second arg
    let count = 1;
    let msgArgs = cleanArgs.slice(1);
    if (msgArgs.length >= 2 && /^\d+$/.test(msgArgs[0])) {
      count = Math.min(parseInt(msgArgs[0], 10), MAX_DM_COUNT);
      msgArgs = msgArgs.slice(1);
    }
    const text = msgArgs.join(" ");
    if (!text) { await message.channel.send("You need to include a message."); return; }
    // Resolve target
    let target: User | null = null;
    if (/^\d+$/.test(userArg)) {
      target = await client.users.fetch(userArg).catch(() => null);
    } else {
      const found = message.guild.members.cache.find(
        m => m.user.username.toLowerCase() === userArg.toLowerCase() || m.displayName.toLowerCase() === userArg.toLowerCase()
      );
      target = found?.user ?? null;
    }
    if (!target) { await message.channel.send(`❌ Couldn't find user **${cleanArgs[0]}**.`); return; }
    const status = await message.channel.send(`⏳ Sending **${count}** DM${count !== 1 ? "s" : ""} to **${target.username}**...`);
    try {
      for (let i = 0; i < count; i++) await target.send(text);
      if (doPing) {
        const pingMsg = await (message.channel as TextChannel).send(`<@${target.id}>`);
        setTimeout(() => pingMsg.delete().catch(() => {}), 3000);
      }
      await status.edit(`✅ Sent **${count}** DM${count !== 1 ? "s" : ""} to **${target.username}**.${doPing ? " Pinged them too." : ""}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await status.edit(
        errMsg.includes("Cannot send messages") || errMsg.includes("50007")
          ? `❌ Couldn't DM **${target.username}** — they likely have DMs turned off or have the bot blocked.`
          : `❌ Failed: ${errMsg.slice(0, 200)}`
      );
    }
    return;
  }

  if (command === "8ball") {
    if (!canUse("8ball")) { await message.channel.send("You don't have permission to use that command."); return; }
    if (!args.length) { await message.channel.send("Usage: `-8ball <question>`"); return; }
    const question = args.join(" ");
    const answer = EIGHT_BALL_RESPONSES[Math.floor(Math.random() * EIGHT_BALL_RESPONSES.length)];
    await message.channel.send(`🎱 **${question}**\n${answer}`);
    return;
  }

  if (command === "rps") {
    if (!canUse("rps")) { await message.channel.send("You don't have permission to use that command."); return; }
    const player = args[0]?.toLowerCase() as RpsMove;
    if (!RPS_MOVES.includes(player)) { await message.channel.send("Usage: `-rps rock`, `-rps paper`, or `-rps scissors`"); return; }
    const botMove = RPS_MOVES[Math.floor(Math.random() * 3)];
    const result = rpsResult(player, botMove);
    const lines = [`You: ${RPS_EMOJI[player]} **${player}** vs Bot: ${RPS_EMOJI[botMove]} **${botMove}**`];
    if (result === "win") lines.push("🎉 You win!");
    else if (result === "lose") lines.push("😔 You lose!");
    else lines.push("🤝 It's a draw!");
    await message.channel.send(lines.join("\n"));
    return;
  }

  if (command === "roll") {
    if (!canUse("roll")) { await message.channel.send("You don't have permission to use that command."); return; }
    const input = args[0] ?? "1d6";
    const match = input.match(/^(\d+)d(\d+)$/i);
    if (!match) { await message.channel.send("❌ Use dice notation like `-roll 2d6` or `-roll 1d20`."); return; }
    const num = Math.min(parseInt(match[1], 10), 20);
    const sides = Math.min(parseInt(match[2], 10), 1000);
    if (num < 1 || sides < 2) { await message.channel.send("❌ Need at least 1 die with 2+ sides."); return; }
    const rolls = Array.from({ length: num }, () => Math.floor(Math.random() * sides) + 1);
    const total = rolls.reduce((a, b) => a + b, 0);
    await message.channel.send(`🎲 Rolling **${num}d${sides}**: [${rolls.join(", ")}] = **${total}**`);
    return;
  }

  if (command === "flip") {
    if (!canUse("flip")) { await message.channel.send("You don't have permission to use that command."); return; }
    await message.channel.send(Math.random() < 0.5 ? "🪙 **Heads!**" : "🪙 **Tails!**");
    return;
  }

  if (command === "mock") {
    if (!canUse("mock")) { await message.channel.send("You don't have permission to use that command."); return; }
    if (!args.length) { await message.channel.send("Usage: `-mock <text>`"); return; }
    await message.channel.send(mockText(args.join(" ")));
    return;
  }

  if (command === "compliment") {
    if (!canUse("compliment")) { await message.channel.send("You don't have permission to use that command."); return; }
    if (!args.length) { await message.channel.send("Usage: `-compliment <@user or name>`"); return; }
    const userArg = args[0].replace(/[<@!>]/g, "");
    let targetName = args[0];
    if (message.guild) {
      const found = /^\d+$/.test(userArg)
        ? await message.guild.members.fetch(userArg).catch(() => null)
        : message.guild.members.cache.find(m => m.user.username.toLowerCase() === userArg.toLowerCase() || m.displayName.toLowerCase() === userArg.toLowerCase()) ?? null;
      if (found) targetName = found.displayName;
    }
    const thinking = await message.channel.send("💭 Thinking of something nice...");
    try {
      const resp = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        max_tokens: 150,
        messages: [
          { role: "system", content: "Generate a warm, genuine, and creative compliment for someone. Keep it 1-3 sentences, friendly and uplifting. Do not start with 'Hey' or their name." },
          { role: "user", content: `Write a compliment for ${targetName}.` },
        ],
      });
      const compliment = resp.choices[0]?.message?.content ?? "You're awesome!";
      await thinking.edit(`💌 **${targetName}**: ${compliment}`);
    } catch { await thinking.edit("❌ Couldn't generate a compliment right now."); }
    return;
  }

  if (command === "snipe") {
    if (!canUse("snipe")) { await message.channel.send("You don't have permission to use that command."); return; }
    const entry = snipeCache.get(message.channelId);
    if (!entry) { await message.channel.send("Nothing to snipe — no deleted messages cached for this channel."); return; }
    const embed = new EmbedBuilder()
      .setColor(0xff4444)
      .setAuthor({ name: entry.authorName, iconURL: entry.authorAvatar })
      .setDescription(entry.content)
      .setFooter({ text: `Deleted ${formatAge(entry.deletedAt)} ago` });
    await message.channel.send({ embeds: [embed] });
    return;
  }

  if (command === "avatar") {
    if (!canUse("avatar")) { await message.channel.send("You don't have permission to use that command."); return; }
    const mentioned = message.mentions.users.first();
    const userArg = args[0]?.replace(/[<@!>]/g, "");
    let target: User = message.author;
    if (mentioned) {
      target = mentioned;
    } else if (userArg && /^\d+$/.test(userArg)) {
      target = await client.users.fetch(userArg).catch(() => message.author);
    } else if (userArg && message.guild) {
      const found = message.guild.members.cache.find(m => m.user.username.toLowerCase() === userArg.toLowerCase() || m.displayName.toLowerCase() === userArg.toLowerCase());
      if (found) target = found.user;
    }
    const avatarUrl = target.displayAvatarURL({ size: 4096 });
    const embed = new EmbedBuilder()
      .setColor(target.accentColor ?? 0x5865f2)
      .setAuthor({ name: target.username, iconURL: avatarUrl })
      .setTitle(`${target.displayName ?? target.username}'s Avatar`)
      .setImage(avatarUrl)
      .addFields(
        { name: "PNG", value: `[Link](${target.displayAvatarURL({ size: 4096, extension: "png" })})`, inline: true },
        { name: "WebP", value: `[Link](${target.displayAvatarURL({ size: 4096, extension: "webp" })})`, inline: true },
        ...(target.avatar?.startsWith("a_") ? [{ name: "GIF", value: `[Link](${target.displayAvatarURL({ size: 4096, extension: "gif" })})`, inline: true }] : []),
      );
    await message.channel.send({ embeds: [embed] });
    return;
  }

  // -balance
  if (command === "balance") {
    if (!canUse("balance")) { await message.channel.send("You don't have permission to use that command."); return; }
    let target = message.author;
    const mentioned = message.mentions.users.first();
    if (mentioned) { target = mentioned; }
    else if (args[0] && /^\d+$/.test(args[0])) { target = await client.users.fetch(args[0]).catch(() => message.author); }
    const bal = Economy.getBalance(target.id);
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
      .setTitle("💰 Wallet")
      .addFields({ name: "Balance", value: Economy.fmt(bal), inline: false })
      .setTimestamp();
    await message.channel.send({ embeds: [embed] });
    return;
  }

  // -addmoney
  if (command === "addmoney") {
    if (message.author.id !== ownerId) { await message.channel.send("Only the bot owner can add money."); return; }
    const target = message.mentions.users.first();
    const amount = parseInt(args[1] ?? "0", 10);
    if (!target || isNaN(amount) || amount <= 0) { await message.channel.send("Usage: `-addmoney @user <amount>`"); return; }
    const newBal = Economy.addBalance(target.id, amount);
    await message.channel.send(`✅ Added **${Economy.fmt(amount)}** to **${target.username}**'s wallet.\nNew balance: **${Economy.fmt(newBal)}**`);
    return;
  }

  // -takemoney
  if (command === "takemoney") {
    if (message.author.id !== ownerId) { await message.channel.send("Only the bot owner can remove money."); return; }
    const target = message.mentions.users.first();
    const amount = parseInt(args[1] ?? "0", 10);
    if (!target || isNaN(amount) || amount <= 0) { await message.channel.send("Usage: `-takemoney @user <amount>`"); return; }
    const newBal = Economy.addBalance(target.id, -amount);
    await message.channel.send(`✅ Removed **${Economy.fmt(amount)}** from **${target.username}**'s wallet.\nNew balance: **${Economy.fmt(newBal)}**`);
    return;
  }

  // -givemoney
  if (command === "givemoney") {
    if (!canUse("givemoney")) { await message.channel.send("You don't have permission to use that command."); return; }
    const target = message.mentions.users.first();
    const amount = parseInt(args[1] ?? "0", 10);
    if (!target || isNaN(amount) || amount <= 0) { await message.channel.send("Usage: `-givemoney @user <amount>`"); return; }
    if (target.id === message.author.id) { await message.channel.send("You can't give money to yourself."); return; }
    const bal = Economy.getBalance(message.author.id);
    if (bal < amount) { await message.channel.send(`❌ You only have **${Economy.fmt(bal)}** — not enough to give **${Economy.fmt(amount)}**.`); return; }
    Economy.addBalance(message.author.id, -amount);
    const newBal = Economy.addBalance(target.id, amount);
    await message.channel.send(`✅ Transferred **${Economy.fmt(amount)}** to **${target.username}**!\nTheir new balance: **${Economy.fmt(newBal)}**`);
    return;
  }

  // -shop
  if (command === "shop") {
    if (!canUse("shop")) { await message.channel.send("You don't have permission to use that command."); return; }
    const footer = { text: `Requested by ${message.author.username}`, iconURL: message.author.displayAvatarURL() };
    const sent = await message.channel.send({ embeds: [buildShopEmbed("Budget", 0, footer)] });
    const msgId = sent.id;
    shopCache.set(msgId, { tier: "Budget", page: 0 });
    scheduleShopCleanup(msgId);
    await sent.edit({ embeds: [buildShopEmbed("Budget", 0, footer)], components: buildShopButtons(msgId, "Budget", 0) });
    return;
  }

  // -buy
  if (command === "buy") {
    if (!canUse("buy")) { await message.channel.send("You don't have permission to use that command."); return; }
    const carQuery = args.join(" ").trim();
    if (!carQuery) { await message.channel.send("Usage: `-buy <car name>` — use `-shop` to browse cars."); return; }
    const car = findCarByName(carQuery);
    if (!car) { await message.channel.send(`❌ Car not found. Use \`-shop\` to browse available cars.`); return; }
    if (Economy.hasCar(message.author.id, car.id)) { await message.channel.send(`You already own the **${car.name}**! View it with \`-garage\`.`); return; }
    const bal = Economy.getBalance(message.author.id);
    if (bal < car.price) { await message.channel.send(`❌ Not enough cash! **${car.name}** costs **${Economy.fmt(car.price)}** and you only have **${Economy.fmt(bal)}**.`); return; }
    Economy.addCar(message.author.id, car.id, car.price);
    const embed = new EmbedBuilder()
      .setColor(car.color)
      .setTitle("🎉 Purchase Successful!")
      .setDescription(`You just bought the **${TIER_EMOJI[car.tier]} ${car.name}**!\nRemaining balance: **${Economy.fmt(Economy.getBalance(message.author.id))}**`)
      .setImage(car.image)
      .setTimestamp();
    await message.channel.send({ embeds: [embed] });
    return;
  }

  // -garage
  if (command === "garage") {
    if (!canUse("garage")) { await message.channel.send("You don't have permission to use that command."); return; }
    let target = message.author;
    const mentioned = message.mentions.users.first();
    if (mentioned) { target = mentioned; }
    else if (args[0] && /^\d+$/.test(args[0])) { target = await client.users.fetch(args[0]).catch(() => message.author); }
    const cars = Economy.getCars(target.id);
    const footer = { text: `${message.author.username}'s view`, iconURL: message.author.displayAvatarURL() };
    const embed = buildGarageListEmbed(target.id, target.username, cars, footer);
    if (cars.length === 0) { await message.channel.send({ embeds: [embed] }); return; }
    const sent = await message.channel.send({ embeds: [embed] });
    const msgId = sent.id;
    garageCache.set(msgId, { ownerId: target.id, cars });
    scheduleGarageCleanup(msgId);
    await sent.edit({ embeds: [embed], components: buildGarageCarButtons(msgId, cars) });
    return;
  }

  await message.channel.send(`Unknown command \`-${command}\`. Type \`-help\` for a list.`);
});

// ─── Start ────────────────────────────────────────────────────────────────────

export function startBot(): void {
  const token = process.env.DISCORD_BOT_TOKEN;
  console.log(`[startBot] DISCORD_BOT_TOKEN present: ${!!token}`);
  if (!token) { console.error("[startBot] DISCORD_BOT_TOKEN is not set — bot will not start"); return; }
  console.log("[startBot] Calling client.login...");
  client.login(token)
    .then(() => console.log("[startBot] client.login resolved successfully"))
    .catch((err) => console.error("[startBot] Failed to log in to Discord:", err));
}
