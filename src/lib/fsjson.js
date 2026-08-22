import { mkdir, readFile, writeFile, unlink, readdir, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export async function ensureDir(directory) {
  await mkdir(directory, { recursive: true });
}

export async function writeJsonAtomic(filePath, data) {
  const absolute = resolve(filePath);
  await ensureDir(dirname(absolute));
  const temp = `${absolute}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2), "utf8");
  await rename(temp, absolute);
}

export async function readJson(filePath, fallback = null) {
  try {
    const raw = await readFile(resolve(filePath), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function removeFile(filePath) {
  try {
    await unlink(resolve(filePath));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export async function listJsonFiles(directory) {
  await ensureDir(directory);
  const files = await readdir(directory);
  return files.filter((file) => file.endsWith(".json") && !file.endsWith(".tmp"));
}

export function jsonPath(directory, id) {
  return join(resolve(directory), `${encodeURIComponent(id)}.json`);
}

export async function cleanupTempFiles(directory) {
  try {
    const files = await readdir(directory);
    await Promise.all(
      files
        .filter((file) => file.endsWith(".tmp"))
        .map((file) => unlink(join(directory, file)).catch(() => {}))
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
