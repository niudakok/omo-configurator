import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";

const HOST = process.env.OMO_WEB_API_HOST || "127.0.0.1";
const PORT = Number(process.env.OMO_WEB_API_PORT || 1422);
const TOKEN = process.env.OMO_WEB_API_TOKEN || randomBytes(24).toString("hex");
const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:1420",
  "http://localhost:1420",
]);

const CONFIG_DIR = path.join(os.homedir(), ".config", "opencode");
const SNAPSHOTS_DIR = path.join(CONFIG_DIR, ".snapshots");
const AUTH_PATH = path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
const SKILLS_DIR = path.join(process.cwd(), ".cursor", "skills");
const OPENCODE_FILE = "opencode.json";
const OH_MY_MODERN_FILE = "oh-my-openagent.json";
const OH_MY_LEGACY_FILE = "oh-my-opencode.json";

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, message) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

function assertOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

function requireToken(req) {
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${TOKEN}`;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function validateSnapshotName(name) {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || /[\\/\0]/.test(trimmed)) {
    throw new Error("Invalid snapshot name");
  }
  return trimmed;
}

function validateSkillName(name) {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || /[\\/\0]/.test(trimmed)) {
    throw new Error("Invalid skill name");
  }
  return trimmed;
}

function validateSkillFilePath(filePath) {
  const trimmed = filePath.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || /[\\/\0]/.test(trimmed)) {
    throw new Error("Invalid skill file path");
  }
  const allowed = [".md", ".txt", ".json", ".yaml", ".yml", ".toml"];
  if (!allowed.some((suffix) => trimmed.endsWith(suffix))) {
    throw new Error("Unsupported skill file extension");
  }
  return trimmed;
}

async function atomicWrite(targetPath, content) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}`;
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, targetPath);
}

async function readConfigFile(kind) {
  if (kind === "opencode") {
    const filePath = path.join(CONFIG_DIR, OPENCODE_FILE);
    return {
      content: await fs.readFile(filePath, "utf8"),
      filename: OPENCODE_FILE,
      resolvedFilename: OPENCODE_FILE,
    };
  }

  const modernPath = path.join(CONFIG_DIR, OH_MY_MODERN_FILE);
  try {
    return {
      content: await fs.readFile(modernPath, "utf8"),
      filename: OH_MY_MODERN_FILE,
      resolvedFilename: OH_MY_MODERN_FILE,
    };
  } catch {
    const legacyPath = path.join(CONFIG_DIR, OH_MY_LEGACY_FILE);
    try {
      return {
        content: await fs.readFile(legacyPath, "utf8"),
        filename: OH_MY_MODERN_FILE,
        resolvedFilename: OH_MY_LEGACY_FILE,
      };
    } catch {
      return {
        content: "{}",
        filename: OH_MY_MODERN_FILE,
        resolvedFilename: null,
      };
    }
  }
}

async function writeConfigFile(kind, content) {
  JSON.parse(content);
  const targetPath =
    kind === "opencode"
      ? path.join(CONFIG_DIR, OPENCODE_FILE)
      : path.join(CONFIG_DIR, OH_MY_MODERN_FILE);
  await atomicWrite(targetPath, content);
}

async function listSnapshots() {
  try {
    const entries = await fs.readdir(SNAPSHOTS_DIR, { withFileTypes: true });
    const snapshots = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(SNAPSHOTS_DIR, entry.name);
      const stat = await fs.stat(fullPath);
      snapshots.push({
        name: entry.name,
        timestamp: Math.floor(stat.mtimeMs / 1000),
      });
    }
    snapshots.sort((a, b) => b.timestamp - a.timestamp);
    return snapshots;
  } catch {
    return [];
  }
}

async function saveSnapshot(name) {
  const snapshotName = validateSnapshotName(name);
  const snapshotDir = path.join(SNAPSHOTS_DIR, snapshotName);
  await fs.mkdir(snapshotDir, { recursive: true });
  const copies = [
    [path.join(CONFIG_DIR, OPENCODE_FILE), OPENCODE_FILE],
    [path.join(CONFIG_DIR, OH_MY_MODERN_FILE), OH_MY_MODERN_FILE],
    [path.join(CONFIG_DIR, OH_MY_LEGACY_FILE), OH_MY_LEGACY_FILE],
  ];
  for (const [src, filename] of copies) {
    try {
      await fs.copyFile(src, path.join(snapshotDir, filename));
    } catch {
      // ignore missing optional files
    }
  }
}

async function restoreSnapshot(name) {
  const snapshotName = validateSnapshotName(name);
  const snapshotDir = path.join(SNAPSHOTS_DIR, snapshotName);
  const restores = [
    [OPENCODE_FILE, path.join(CONFIG_DIR, OPENCODE_FILE)],
    [OH_MY_MODERN_FILE, path.join(CONFIG_DIR, OH_MY_MODERN_FILE)],
    [OH_MY_LEGACY_FILE, path.join(CONFIG_DIR, OH_MY_LEGACY_FILE)],
  ];
  for (const [filename, dst] of restores) {
    const src = path.join(snapshotDir, filename);
    try {
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(src, dst);
    } catch {
      // ignore missing optional files
    }
  }
}

async function deleteSnapshot(name) {
  const snapshotName = validateSnapshotName(name);
  await fs.rm(path.join(SNAPSHOTS_DIR, snapshotName), { recursive: true, force: true });
}

async function renameSnapshot(from, to) {
  const fromName = validateSnapshotName(from);
  const toName = validateSnapshotName(to);
  if (fromName === toName) return;
  await fs.rename(path.join(SNAPSHOTS_DIR, fromName), path.join(SNAPSHOTS_DIR, toName));
}

async function exportSnapshot(name) {
  const snapshotName = validateSnapshotName(name);
  const snapshotDir = path.join(SNAPSHOTS_DIR, snapshotName);
  const exportData = {};
  for (const filename of [OPENCODE_FILE, OH_MY_MODERN_FILE, OH_MY_LEGACY_FILE]) {
    try {
      exportData[filename] = await fs.readFile(path.join(snapshotDir, filename), "utf8");
    } catch {
      // ignore missing optional files
    }
  }
  return JSON.stringify(exportData, null, 2);
}

async function listSkills() {
  try {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(SKILLS_DIR, entry.name);
      const stat = await fs.stat(skillDir);
      const files = [];
      const skillEntries = await fs.readdir(skillDir, { withFileTypes: true });
      for (const skillEntry of skillEntries) {
        if (!skillEntry.isFile()) continue;
        try {
          const safePath = validateSkillFilePath(skillEntry.name);
          const fileStat = await fs.stat(path.join(skillDir, safePath));
          files.push({ path: safePath, size: fileStat.size });
        } catch {
          // ignore unsupported files
        }
      }
      files.sort((a, b) => a.path.localeCompare(b.path));
      result.push({
        name: entry.name,
        updated_at: Math.floor(stat.mtimeMs / 1000),
        files,
      });
    }
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  } catch {
    return [];
  }
}

async function readSkill(name) {
  const skillName = validateSkillName(name);
  const skillDir = path.join(SKILLS_DIR, skillName);
  const entries = await fs.readdir(skillDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      const safePath = validateSkillFilePath(entry.name);
      files.push({
        path: safePath,
        content: await fs.readFile(path.join(skillDir, safePath), "utf8"),
      });
    } catch {
      // ignore unsupported files
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const stat = await fs.stat(skillDir);
  return {
    name: skillName,
    updated_at: Math.floor(stat.mtimeMs / 1000),
    files,
  };
}

async function createSkill(name, content) {
  const skillName = validateSkillName(name);
  const skillDir = path.join(SKILLS_DIR, skillName);
  await fs.mkdir(skillDir, { recursive: false });
  await atomicWrite(path.join(skillDir, "SKILL.md"), content);
}

async function writeSkillFile(name, filePath, content) {
  const skillName = validateSkillName(name);
  const safePath = validateSkillFilePath(filePath);
  const skillDir = path.join(SKILLS_DIR, skillName);
  await atomicWrite(path.join(skillDir, safePath), content);
}

async function getRuntimeInfo() {
  const loadedFiles = [];
  try {
    await fs.access(path.join(CONFIG_DIR, OPENCODE_FILE));
    loadedFiles.push(OPENCODE_FILE);
  } catch {}
  try {
    await fs.access(path.join(CONFIG_DIR, OH_MY_MODERN_FILE));
    loadedFiles.push(OH_MY_MODERN_FILE);
  } catch {
    try {
      await fs.access(path.join(CONFIG_DIR, OH_MY_LEGACY_FILE));
      loadedFiles.push(OH_MY_LEGACY_FILE);
    } catch {}
  }
  let hasAuth = false;
  try {
    await fs.access(AUTH_PATH);
    hasAuth = true;
  } catch {}
  return {
    mode: "server-backed",
    token: TOKEN,
    sourceName: CONFIG_DIR,
    loadedFiles,
    hasAuth,
  };
}

const server = createServer(async (req, res) => {
  try {
    if (!req.url || !req.method) {
      sendText(res, 400, "Bad request");
      return;
    }

    if (!assertOrigin(req)) {
      sendText(res, 403, "Forbidden origin");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
    const pathname = url.pathname;

    if (pathname === "/api/runtime" && req.method === "GET") {
      sendJson(res, 200, await getRuntimeInfo());
      return;
    }

    if (!requireToken(req)) {
      sendText(res, 401, "Unauthorized");
      return;
    }

    if (pathname === "/api/config/opencode" && req.method === "GET") {
      sendJson(res, 200, await readConfigFile("opencode"));
      return;
    }

    if (pathname === "/api/config/oh-my" && req.method === "GET") {
      sendJson(res, 200, await readConfigFile("oh-my"));
      return;
    }

    if (pathname === "/api/config/opencode" && req.method === "PUT") {
      const body = await readBody(req);
      await writeConfigFile("opencode", body.content);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/api/config/oh-my" && req.method === "PUT") {
      const body = await readBody(req);
      await writeConfigFile("oh-my", body.content);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/api/auth" && req.method === "GET") {
      let content = "{}";
      try {
        content = await fs.readFile(AUTH_PATH, "utf8");
      } catch {
        content = "{}";
      }
      sendJson(res, 200, { content });
      return;
    }

    if (pathname === "/api/snapshots" && req.method === "GET") {
      sendJson(res, 200, { items: await listSnapshots() });
      return;
    }

    if (pathname === "/api/snapshots" && req.method === "POST") {
      const body = await readBody(req);
      await saveSnapshot(body.name);
      sendJson(res, 200, { ok: true });
      return;
    }

    const snapshotMatch = pathname.match(/^\/api\/snapshots\/([^/]+)$/);
    const snapshotRestoreMatch = pathname.match(/^\/api\/snapshots\/([^/]+)\/restore$/);
    const snapshotRenameMatch = pathname.match(/^\/api\/snapshots\/([^/]+)\/rename$/);
    const snapshotExportMatch = pathname.match(/^\/api\/snapshots\/([^/]+)\/export$/);

    if (snapshotMatch && req.method === "DELETE") {
      await deleteSnapshot(decodeURIComponent(snapshotMatch[1]));
      sendJson(res, 200, { ok: true });
      return;
    }

    if (snapshotRestoreMatch && req.method === "POST") {
      await restoreSnapshot(decodeURIComponent(snapshotRestoreMatch[1]));
      sendJson(res, 200, { ok: true });
      return;
    }

    if (snapshotRenameMatch && req.method === "POST") {
      const body = await readBody(req);
      await renameSnapshot(decodeURIComponent(snapshotRenameMatch[1]), body.to);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (snapshotExportMatch && req.method === "GET") {
      sendJson(res, 200, { content: await exportSnapshot(decodeURIComponent(snapshotExportMatch[1])) });
      return;
    }

    if (pathname === "/api/skills" && req.method === "GET") {
      sendJson(res, 200, { items: await listSkills() });
      return;
    }

    if (pathname === "/api/skills" && req.method === "POST") {
      const body = await readBody(req);
      await createSkill(body.name, body.content);
      sendJson(res, 200, { ok: true });
      return;
    }

    const skillMatch = pathname.match(/^\/api\/skills\/([^/]+)$/);
    const skillFileMatch = pathname.match(/^\/api\/skills\/([^/]+)\/files\/([^/]+)$/);

    if (skillMatch && req.method === "GET") {
      sendJson(res, 200, { detail: await readSkill(decodeURIComponent(skillMatch[1])) });
      return;
    }

    if (skillFileMatch && req.method === "PUT") {
      const body = await readBody(req);
      await writeSkillFile(
        decodeURIComponent(skillFileMatch[1]),
        decodeURIComponent(skillFileMatch[2]),
        body.content,
      );
      sendJson(res, 200, { ok: true });
      return;
    }

    sendText(res, 404, "Not found");
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`OmO web config API listening on http://${HOST}:${PORT}`);
});
