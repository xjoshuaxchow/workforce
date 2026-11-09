import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${(await scrypt(password, salt, 64)).toString("hex")}`;
}
export async function verifyPassword(password, encoded) {
  const [method, salt, hex] = encoded.split(":");
  if (method !== "scrypt" || !salt || !hex) return false;
  const actual = await scrypt(password, salt, 64),
    expected = Buffer.from(hex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const newToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (token) =>
  createHash("sha256").update(token).digest("hex");
