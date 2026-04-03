import fs from "fs";
import path from "path";

const DATA_PATH = path.join(process.cwd(), "perms.json");

type PermsData = Record<string, Record<string, string[]>>;

export const ALL_COMMANDS = ["say", "spam", "spamme", "delete", "ping", "ttt", "latency", "user", "role", "dm", "8ball", "rps", "roll", "flip", "mock", "compliment", "bully", "ragebait", "fake", "snipe", "avatar", "uwr", "balance", "addmoney", "takemoney", "givemoney", "shop", "buy", "garage"];
// "help", "perms", "ai" are excluded — always available or already owner-only

export const COMMAND_LABELS: Record<string, string> = {
  say: "Say",
  spam: "Spam",
  spamme: "Spam as Me",
  delete: "Delete",
  ping: "Ping",
  ttt: "Tic-Tac-Toe",
  latency: "Latency",
  user: "User Info",
  role: "Manage Roles",
  dm: "Send DM",
  "8ball": "8-Ball",
  rps: "Rock Paper Scissors",
  roll: "Dice Roll",
  flip: "Coin Flip",
  mock: "Mock Text",
  compliment: "Compliment",
  bully: "Bully",
  ragebait: "Ragebait",
  fake: "Fake Message",
  snipe: "Snipe",
  avatar: "Avatar",
  uwr: "Role Members",
  balance: "Balance",
  addmoney: "Add Money",
  takemoney: "Take Money",
  givemoney: "Give Money",
  shop: "Car Shop",
  buy: "Buy Car",
  garage: "Garage",
};

const USER_PREFIX = "user:";

let data: PermsData = {};

function load() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
}

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to save perms:", err);
  }
}

load();

/**
 * Returns true if the user is allowed to run the command.
 * User-specific permissions take precedence over role permissions.
 * DEFAULT: owner-only (deny all) until permissions are explicitly granted via -perms.
 */
export function hasPermission(
  guildId: string,
  memberRoleIds: string[],
  command: string,
  userId?: string,
): boolean {
  const guild = data[guildId];
  if (!guild || Object.keys(guild).length === 0) return false;

  // User-specific override takes precedence
  if (userId) {
    const userPerms = guild[`${USER_PREFIX}${userId}`];
    if (userPerms && userPerms.includes(command)) return true;
  }

  for (const roleId of memberRoleIds) {
    const allowed = guild[roleId];
    if (allowed && allowed.includes(command)) return true;
  }
  return false;
}

export function getRolePerms(guildId: string, roleId: string): string[] {
  return data[guildId]?.[roleId] ?? [];
}

export function setRolePerms(guildId: string, roleId: string, commands: string[]) {
  if (!data[guildId]) data[guildId] = {};
  data[guildId][roleId] = commands;
  save();
}

export function toggleRolePerm(guildId: string, roleId: string, command: string): boolean {
  if (!data[guildId]) data[guildId] = {};
  if (!data[guildId][roleId]) data[guildId][roleId] = [];

  const list = data[guildId][roleId];
  const idx = list.indexOf(command);
  if (idx === -1) {
    list.push(command);
    save();
    return true;
  } else {
    list.splice(idx, 1);
    save();
    return false;
  }
}

export function getUserPerms(guildId: string, userId: string): string[] {
  return data[guildId]?.[`${USER_PREFIX}${userId}`] ?? [];
}

export function toggleUserPerm(guildId: string, userId: string, command: string): boolean {
  if (!data[guildId]) data[guildId] = {};
  const key = `${USER_PREFIX}${userId}`;
  if (!data[guildId][key]) data[guildId][key] = [];

  const list = data[guildId][key];
  const idx = list.indexOf(command);
  if (idx === -1) {
    list.push(command);
    save();
    return true;
  } else {
    list.splice(idx, 1);
    save();
    return false;
  }
}

export function guildHasConfig(guildId: string): boolean {
  return !!data[guildId] && Object.keys(data[guildId]).length > 0;
}
