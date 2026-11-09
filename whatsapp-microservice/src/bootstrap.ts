import { randomBytes } from "node:crypto";
import { chown, chmod, mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
export async function initialize(
  configPath: string,
  mediaPath: string,
): Promise<void> {
  for (const dir of [configPath, mediaPath]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (process.getuid?.() === 0) await chown(dir, 10001, 10001);
    await chmod(dir, 0o700);
  }
  for (const name of ["postgres-password", "api-key"]) {
    const path = join(configPath, name);
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(randomBytes(32).toString("hex") + "\n");
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if ((await readFile(path, "utf8")).trim().length < 32)
      throw new Error(
        `Invalid persisted ${name}; refusing to rotate automatically`,
      );
    if (process.getuid?.() === 0) await chown(path, 10001, 10001);
    await chmod(path, 0o600);
  }
}
