import type { AuthConfig } from "@/types/config";
import { RECOMMENDED_AGENTS, RECOMMENDED_CATEGORIES } from "@/lib/recommended-models";

export interface SnapshotInfo {
  name: string;
  timestamp: number;
}

export interface SkillFileInfo {
  path: string;
  size: number;
}

export interface SkillSummary {
  name: string;
  updated_at: number;
  files: SkillFileInfo[];
}

export interface SkillFileContent {
  path: string;
  content: string;
}

export interface SkillDetail {
  name: string;
  updated_at: number;
  files: SkillFileContent[];
}

type TauriCore = typeof import("@tauri-apps/api/core");
type TauriApp = typeof import("@tauri-apps/api/app");

interface BrowserSnapshot {
  name: string;
  timestamp: number;
  files: Record<string, string>;
}

const STORAGE_PREFIX = "omo-configurator";
const OPENCODE_FILE = "opencode.json";
const OH_MY_FILE = "oh-my-opencode.json";
const AUTH_FILE = "auth.json";
const SNAPSHOTS_KEY = `${STORAGE_PREFIX}:snapshots`;
const BROWSER_SKILLS_KEY = `${STORAGE_PREFIX}:skills`;

const browserInitialOpenCode = JSON.stringify(
  {
    plugin: ["oh-my-openagent@0.0.0"],
    mcp: {},
    provider: {},
  },
  null,
  2,
);

const browserInitialOhMy = JSON.stringify(
  {
    agents: Object.fromEntries(
      Object.entries(RECOMMENDED_AGENTS).map(([name, recommendation]) => [
        name,
        { model: recommendation.model, variant: recommendation.variant },
      ]),
    ),
    categories: Object.fromEntries(
      Object.entries(RECOMMENDED_CATEGORIES).map(([name, recommendation]) => [
        name,
        { model: recommendation.model, variant: recommendation.variant },
      ]),
    ),
  },
  null,
  2,
);

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function loadTauriCore(): Promise<TauriCore> {
  return import("@tauri-apps/api/core");
}

async function loadTauriApp(): Promise<TauriApp> {
  return import("@tauri-apps/api/app");
}

function storageKey(filename: string): string {
  return `${STORAGE_PREFIX}:config:${filename}`;
}

function readBrowserConfig(filename: string): string {
  const stored = window.localStorage.getItem(storageKey(filename));
  if (stored !== null) return stored;
  if (filename === OPENCODE_FILE) return browserInitialOpenCode;
  if (filename === OH_MY_FILE) return browserInitialOhMy;
  return "{}";
}

function readBrowserSnapshots(): BrowserSnapshot[] {
  const raw = window.localStorage.getItem(SNAPSHOTS_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is BrowserSnapshot => {
    if (typeof item !== "object" || item === null) return false;
    const snapshot = item as Partial<BrowserSnapshot>;
    return (
      typeof snapshot.name === "string" &&
      typeof snapshot.timestamp === "number" &&
      typeof snapshot.files === "object" &&
      snapshot.files !== null
    );
  });
}

function writeBrowserSnapshots(snapshots: BrowserSnapshot[]): void {
  window.localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots));
}

function readBrowserSkills(): Record<string, Record<string, string>> {
  const raw = window.localStorage.getItem(BROWSER_SKILLS_KEY);
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) return {};
  const skills: Record<string, Record<string, string>> = {};
  for (const [name, files] of Object.entries(parsed)) {
    if (typeof files !== "object" || files === null) continue;
    skills[name] = {};
    for (const [path, content] of Object.entries(files)) {
      if (typeof content === "string") skills[name][path] = content;
    }
  }
  return skills;
}

function writeBrowserSkills(skills: Record<string, Record<string, string>>): void {
  window.localStorage.setItem(BROWSER_SKILLS_KEY, JSON.stringify(skills));
}

function validateSkillName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Skill name cannot be empty");
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("Skill name cannot contain path separators");
  }
  if (trimmed === "." || trimmed === "..") throw new Error("Invalid skill name");
  return trimmed;
}

function validateSkillFilePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("Skill file path cannot be empty");
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("Only top-level skill files can be edited");
  }
  if (trimmed === "." || trimmed === "..") throw new Error("Invalid skill file path");
  const allowed = [".md", ".txt", ".json", ".yaml", ".yml", ".toml"];
  if (!allowed.some((suffix) => trimmed.endsWith(suffix))) {
    throw new Error("Only Markdown, text, JSON, YAML, or TOML files are supported");
  }
  return trimmed;
}

function validateSnapshotName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Snapshot name cannot be empty");
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("Snapshot name cannot contain path separators");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error("Invalid snapshot name");
  }
  return trimmed;
}

export function getRuntimeMode(): "tauri" | "browser" {
  return isTauriRuntime() ? "tauri" : "browser";
}

export async function readConfig(filename: string): Promise<string> {
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    return invoke<string>("read_config", { filename });
  }
  return readBrowserConfig(filename);
}

export async function writeConfig(filename: string, content: string): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    await invoke("write_config", { filename, content });
    return;
  }
  window.localStorage.setItem(storageKey(filename), content);
}

export async function readAuth(): Promise<string> {
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    return invoke<string>("read_auth");
  }
  return window.localStorage.getItem(storageKey(AUTH_FILE)) ?? "{}";
}

export async function getAppVersion(): Promise<string> {
  if (isTauriRuntime()) {
    const { getVersion } = await loadTauriApp();
    return getVersion();
  }
  return __APP_VERSION__;
}

export async function listSnapshots(): Promise<SnapshotInfo[]> {
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    return invoke<SnapshotInfo[]>("list_snapshots");
  }
  return readBrowserSnapshots()
    .map(({ name, timestamp }) => ({ name, timestamp }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

export async function saveSnapshot(name: string): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    await invoke("save_snapshot", { name });
    return;
  }
  const snapshotName = validateSnapshotName(name);
  const snapshots = readBrowserSnapshots().filter(
    (snapshot) => snapshot.name !== snapshotName,
  );
  snapshots.push({
    name: snapshotName,
    timestamp: Math.floor(Date.now() / 1000),
    files: {
      [OPENCODE_FILE]: readBrowserConfig(OPENCODE_FILE),
      "oh-my-openagent.json": readBrowserConfig(OH_MY_FILE),
    },
  });
  writeBrowserSnapshots(snapshots);
}

export async function restoreSnapshot(name: string): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    await invoke("restore_snapshot", { name });
    return;
  }
  const snapshot = readBrowserSnapshots().find((item) => item.name === name);
  if (!snapshot) throw new Error(`Snapshot ${name} does not exist`);
  if (snapshot.files[OPENCODE_FILE]) {
    window.localStorage.setItem(storageKey(OPENCODE_FILE), snapshot.files[OPENCODE_FILE]);
  }
  const ohMyContent = snapshot.files["oh-my-openagent.json"] ?? snapshot.files[OH_MY_FILE];
  if (ohMyContent) window.localStorage.setItem(storageKey(OH_MY_FILE), ohMyContent);
}

export async function deleteSnapshot(name: string): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    await invoke("delete_snapshot", { name });
    return;
  }
  writeBrowserSnapshots(
    readBrowserSnapshots().filter((snapshot) => snapshot.name !== name),
  );
}

export async function renameSnapshot(from: string, to: string): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    await invoke("rename_snapshot", { from, to });
    return;
  }
  const fromName = validateSnapshotName(from);
  const toName = validateSnapshotName(to);
  const snapshots = readBrowserSnapshots();
  if (snapshots.some((snapshot) => snapshot.name === toName)) {
    throw new Error(`Snapshot ${toName} already exists`);
  }
  const snapshot = snapshots.find((item) => item.name === fromName);
  if (!snapshot) throw new Error(`Snapshot ${fromName} does not exist`);
  snapshot.name = toName;
  snapshot.timestamp = Math.floor(Date.now() / 1000);
  writeBrowserSnapshots(snapshots);
}

export async function exportSnapshot(name: string): Promise<string> {
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    return invoke<string>("export_snapshot", { name });
  }
  const snapshot = readBrowserSnapshots().find((item) => item.name === name);
  if (!snapshot) throw new Error(`Snapshot ${name} does not exist`);
  return JSON.stringify(snapshot.files, null, 2);
}

export async function listSkills(): Promise<SkillSummary[]> {
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    return invoke<SkillSummary[]>("list_skills");
  }
  const skills = readBrowserSkills();
  return Object.entries(skills)
    .map(([name, files]) => ({
      name,
      updated_at: 0,
      files: Object.entries(files)
        .map(([path, content]) => ({ path, size: content.length }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function readSkill(name: string): Promise<SkillDetail> {
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    return invoke<SkillDetail>("read_skill", { name });
  }
  const skillName = validateSkillName(name);
  const skills = readBrowserSkills();
  const files = skills[skillName];
  if (!files) throw new Error(`Skill ${skillName} does not exist`);
  return {
    name: skillName,
    updated_at: 0,
    files: Object.entries(files)
      .map(([path, content]) => ({ path, content }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export async function createSkill(name: string, content: string): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    await invoke("create_skill", { name, content });
    return;
  }
  const skillName = validateSkillName(name);
  const skills = readBrowserSkills();
  if (skills[skillName]) throw new Error(`Skill ${skillName} already exists`);
  skills[skillName] = { "SKILL.md": content };
  writeBrowserSkills(skills);
}

export async function writeSkillFile(
  name: string,
  path: string,
  content: string,
): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    await invoke("write_skill_file", { name, path, content });
    return;
  }
  const skillName = validateSkillName(name);
  const filePath = validateSkillFilePath(path);
  const skills = readBrowserSkills();
  if (!skills[skillName]) throw new Error(`Skill ${skillName} does not exist`);
  skills[skillName][filePath] = content;
  writeBrowserSkills(skills);
}

export async function fetchZenModels(apiKey: string): Promise<string[]> {
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    const json = await invoke<string>("fetch_zen_models", { apiKey });
    return JSON.parse(json) as string[];
  }
  const response = await fetch("https://opencode.ai/zen/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`zen models returned HTTP ${response.status}`);
  const parsed: unknown = await response.json();
  if (typeof parsed !== "object" || parsed === null || !("data" in parsed)) {
    return [];
  }
  const data = (parsed as { data: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    if (typeof item !== "object" || item === null || !("id" in item)) return [];
    const id = (item as { id: unknown }).id;
    return typeof id === "string" ? [`opencode/${id}`] : [];
  });
}

export async function fetchModelsDevProviders(providerIds: string[]): Promise<string[]> {
  if (providerIds.length === 0) return [];
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    const json = await invoke<string>("fetch_models_dev", { providerIds });
    return JSON.parse(json) as string[];
  }
  const response = await fetch("https://models.dev/api.json");
  if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`);
  const parsed: unknown = await response.json();
  if (typeof parsed !== "object" || parsed === null) return [];
  const providers = parsed as Record<string, unknown>;
  return providerIds.flatMap((providerId) => {
    const provider = providers[providerId];
    if (typeof provider !== "object" || provider === null || !("models" in provider)) {
      return [];
    }
    const models = (provider as { models: unknown }).models;
    if (typeof models !== "object" || models === null) return [];
    return Object.keys(models).map((modelId) => `${providerId}/${modelId}`);
  });
}

export function describeBrowserLimitations(auth: AuthConfig): string | null {
  if (isTauriRuntime()) return null;
  if (Object.keys(auth).length === 0) {
    return "Browser mode uses localStorage and cannot read ~/.local/share/opencode/auth.json. Connected provider models load after you add auth-backed providers in desktop mode or model entries in Providers.";
  }
  return "Browser mode fetches external provider models directly from the browser, so some providers may be limited by CORS or network policy.";
}
