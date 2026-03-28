import fs from "fs";
import path from "path";

const DATA_PATH = path.join(process.cwd(), "economy.json");

export interface Customization {
  colorName?: string;
  colorHex?: number;
  imageUrl?: string;
  plate?: string;
}

interface UserData {
  balance: number;
  cars: string[];
  customizations?: Record<string, Customization>;
}

type EconomyDB = Record<string, UserData>;

function load(): EconomyDB {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8")) as EconomyDB;
  } catch {
    return {};
  }
}

function save(db: EconomyDB): void {
  fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2));
}

function ensure(db: EconomyDB, userId: string): UserData {
  if (!db[userId]) db[userId] = { balance: 0, cars: [] };
  return db[userId];
}

export function getUser(userId: string): UserData {
  const db = load();
  return { ...ensure(db, userId) };
}

export function getBalance(userId: string): number {
  return getUser(userId).balance;
}

export function addBalance(userId: string, amount: number): number {
  const db = load();
  const user = ensure(db, userId);
  user.balance = Math.max(0, user.balance + Math.floor(amount));
  save(db);
  return user.balance;
}

export function setBalance(userId: string, amount: number): number {
  const db = load();
  const user = ensure(db, userId);
  user.balance = Math.max(0, Math.floor(amount));
  save(db);
  return user.balance;
}

export function hasCar(userId: string, carId: string): boolean {
  return getUser(userId).cars.includes(carId);
}

export function addCar(userId: string, carId: string, price: number): boolean {
  const db = load();
  const user = ensure(db, userId);
  if (user.balance < price) return false;
  if (user.cars.includes(carId)) return false;
  user.balance -= price;
  user.cars.push(carId);
  save(db);
  return true;
}

export function removeCar(userId: string, carId: string): void {
  const db = load();
  const user = ensure(db, userId);
  user.cars = user.cars.filter(id => id !== carId);
  if (user.customizations) delete user.customizations[carId];
  save(db);
}

export function getCars(userId: string): string[] {
  return [...getUser(userId).cars];
}

export function getCustomization(userId: string, carId: string): Customization {
  const db = load();
  return { ...(db[userId]?.customizations?.[carId] ?? {}) };
}

export function setCustomization(userId: string, carId: string, update: Partial<Customization>): void {
  const db = load();
  const user = ensure(db, userId);
  if (!user.customizations) user.customizations = {};
  user.customizations[carId] = { ...(user.customizations[carId] ?? {}), ...update };
  save(db);
}

export function clearCustomization(userId: string, carId: string): void {
  const db = load();
  const user = ensure(db, userId);
  if (user.customizations) delete user.customizations[carId];
  save(db);
}

export function fmt(n: number): string {
  return `💵 ${n.toLocaleString("en-US")}`;
}
