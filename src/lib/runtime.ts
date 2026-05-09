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

export type BrowserConfigSessionKind = "unloaded" | "imported" | "file-backed" | "server-backed";

export interface BrowserConfigSessionInfo {
  kind: BrowserConfigSessionKind;
  dirty: boolean;
  canSaveToDisk: boolean;
  sourceName: string | null;
  loadedFiles: string[];
  hasAuth: boolean;
}

type BrowserConfigFilename = "opencode.json" | "oh-my-openagent.json" | "oh-my-opencode.json";

interface BrowserFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<BrowserWritableFileStream>;
}

interface BrowserWritableFileStream {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

interface BrowserDirectoryHandle {
  name: string;
  getFileHandle(name: string): Promise<BrowserFileHandle>;
}

interface BrowserOpenFilePickerOptions {
  multiple?: boolean;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}

interface BrowserSaveFilePickerOptions {
  suggestedName?: string;
  types?: BrowserOpenFilePickerOptions["types"];
}

interface BrowserWindowWithFileSystemAccess extends Window {
  showOpenFilePicker?: (options?: BrowserOpenFilePickerOptions) => Promise<BrowserFileHandle[]>;
  showDirectoryPicker?: () => Promise<BrowserDirectoryHandle>;
  showSaveFilePicker?: (options?: BrowserSaveFilePickerOptions) => Promise<BrowserFileHandle>;
}

interface BrowserConfigSession {
  kind: BrowserConfigSessionKind;
  dirty: boolean;
  sourceName: string | null;
  files: Partial<Record<BrowserConfigFilename, string>>;
  auth: string;
  fileHandles: Partial<Record<"opencode.json" | "oh-my-openagent.json", BrowserFileHandle>>;
  loadedFiles: Set<string>;
}

interface BrowserServerRuntime {
  token: string;
  sourceName: string;
  loadedFiles: string[];
  hasAuth: boolean;
}

const STORAGE_PREFIX = "omo-configurator";
const OPENCODE_FILE = "opencode.json";
const OH_MY_LEGACY_FILE = "oh-my-opencode.json";
const OH_MY_MODERN_FILE = "oh-my-openagent.json";
const AUTH_FILE = "auth.json";
const SNAPSHOTS_KEY = `${STORAGE_PREFIX}:snapshots`;
const BROWSER_SKILLS_KEY = `${STORAGE_PREFIX}:skills`;
const LEGACY_BROWSER_CONFIG_KEYS = [
  `${STORAGE_PREFIX}:config:${OPENCODE_FILE}`,
  `${STORAGE_PREFIX}:config:${OH_MY_LEGACY_FILE}`,
  `${STORAGE_PREFIX}:config:${OH_MY_MODERN_FILE}`,
  `${STORAGE_PREFIX}:config:${AUTH_FILE}`,
];
const CONFIG_JSON_TYPES = [
  {
    description: "OpenCode configuration JSON",
    accept: { "application/json": [".json"] },
  },
];

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

const browserSession: BrowserConfigSession = {
  kind: "unloaded",
  dirty: false,
  sourceName: null,
  files: {},
  auth: "{}",
  fileHandles: {},
  loadedFiles: new Set(),
};

let browserServerRuntime: BrowserServerRuntime | null = null;

function isTauriRuntime(): boolean {
  return Object.prototype.hasOwnProperty.call(window, "__TAURI_INTERNALS__");
}

async function loadTauriCore(): Promise<TauriCore> {
  return import("@tauri-apps/api/core");
}

async function loadTauriApp(): Promise<TauriApp> {
  return import("@tauri-apps/api/app");
}

function browserWindow(): BrowserWindowWithFileSystemAccess {
  return window as BrowserWindowWithFileSystemAccess;
}

function clearLegacyBrowserConfigKeys(): void {
  if (isTauriRuntime()) return;
  for (const key of LEGACY_BROWSER_CONFIG_KEYS) {
    window.localStorage.removeItem(key);
  }
}

async function apiFetch(pathname: string, init: RequestInit = {}): Promise<Response> {
  if (!browserServerRuntime) {
    throw new Error("Server-backed browser runtime is not available.");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${browserServerRuntime.token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(pathname, { ...init, headers });
  if (!response.ok) {
    let message = `${init.method ?? "GET"} ${pathname} failed with HTTP ${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore malformed error payload
    }
    throw new Error(message);
  }
  return response;
}

async function apiJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(pathname, init);
  return (await response.json()) as T;
}

function normalizeBrowserConfigFilename(filename: string): BrowserConfigFilename | null {
  if (
    filename === OPENCODE_FILE ||
    filename === OH_MY_MODERN_FILE ||
    filename === OH_MY_LEGACY_FILE
  ) {
    return filename;
  }
  return null;
}

function readBrowserConfig(filename: string): string {
  if (browserSession.kind === "unloaded") {
    throw new Error("Browser configuration is not loaded. Import files or open a config folder first.");
  }
  if (filename === OPENCODE_FILE) {
    return browserSession.files[OPENCODE_FILE] ?? "{}";
  }
  if (filename === OH_MY_LEGACY_FILE || filename === OH_MY_MODERN_FILE) {
    return (
      browserSession.files[OH_MY_MODERN_FILE] ??
      browserSession.files[OH_MY_LEGACY_FILE] ??
      "{}"
    );
  }
  if (filename === AUTH_FILE) return browserSession.auth;
  return "{}";
}

function writeBrowserSessionFile(filename: string, content: string): void {
  if (browserSession.kind === "unloaded") {
    throw new Error("Browser configuration is not loaded. Import files or open a config folder first.");
  }
  if (filename === OPENCODE_FILE) {
    browserSession.files[OPENCODE_FILE] = content;
    browserSession.loadedFiles.add(OPENCODE_FILE);
  } else if (filename === OH_MY_LEGACY_FILE || filename === OH_MY_MODERN_FILE) {
    browserSession.files[OH_MY_MODERN_FILE] = content;
    browserSession.loadedFiles.add(OH_MY_MODERN_FILE);
  } else {
    throw new Error(`Browser mode cannot write ${filename}`);
  }
  browserSession.dirty = true;
}

function resetBrowserSession(
  kind: BrowserConfigSessionKind,
  sourceName: string | null,
  files: Partial<Record<BrowserConfigFilename, string>>,
  auth: string,
  fileHandles: BrowserConfigSession["fileHandles"] = {},
): void {
  browserSession.kind = kind;
  browserSession.sourceName = sourceName;
  browserSession.files = files;
  browserSession.auth = auth;
  browserSession.fileHandles = fileHandles;
  browserSession.loadedFiles = new Set(Object.keys(files));
  if (auth !== "{}") browserSession.loadedFiles.add(AUTH_FILE);
  browserSession.dirty = false;
}

function browserSessionInfo(): BrowserConfigSessionInfo {
  return {
    kind: browserSession.kind,
    dirty: browserSession.dirty,
    canSaveToDisk:
      (browserSession.kind === "file-backed" &&
        !!browserSession.fileHandles[OPENCODE_FILE] &&
        !!browserSession.fileHandles[OH_MY_MODERN_FILE]) ||
      browserSession.kind === "server-backed",
    sourceName: browserSession.sourceName,
    loadedFiles:
      browserSession.kind === "server-backed" && browserServerRuntime
        ? [...browserServerRuntime.loadedFiles].sort()
        : Array.from(browserSession.loadedFiles).sort(),
    hasAuth:
      browserSession.kind === "server-backed" && browserServerRuntime
        ? browserServerRuntime.hasAuth
        : browserSession.auth !== "{}",
  };
}

async function readHandleIfExists(
  directory: BrowserDirectoryHandle,
  filename: BrowserConfigFilename | typeof AUTH_FILE,
): Promise<{ handle: BrowserFileHandle; content: string } | null> {
  try {
    const handle = await directory.getFileHandle(filename);
    return { handle, content: await (await handle.getFile()).text() };
  } catch {
    return null;
  }
}

function downloadJson(filename: string, content: string): void {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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

export function initializeBrowserRuntime(): void {
  clearLegacyBrowserConfigKeys();
}

export async function initializeBrowserRuntimeSession(): Promise<BrowserConfigSessionInfo> {
  initializeBrowserRuntime();
  if (isTauriRuntime()) return getBrowserConfigSessionInfo();
  try {
    const runtime = await fetch("/api/runtime").then(async (response) => {
      if (!response.ok) {
        throw new Error(`Runtime probe failed with HTTP ${response.status}`);
      }
      return (await response.json()) as {
        mode: string;
        token: string;
        sourceName: string;
        loadedFiles: string[];
        hasAuth: boolean;
      };
    });

    if (runtime.mode !== "server-backed" || !runtime.token) {
      throw new Error("Server-backed runtime is unavailable.");
    }

    browserServerRuntime = {
      token: runtime.token,
      sourceName: runtime.sourceName,
      loadedFiles: runtime.loadedFiles,
      hasAuth: runtime.hasAuth,
    };
    resetBrowserSession("server-backed", runtime.sourceName, {}, runtime.hasAuth ? "pending" : "{}", {});
    browserSession.loadedFiles = new Set(runtime.loadedFiles);
    browserSession.dirty = false;
    return browserSessionInfo();
  } catch {
    browserServerRuntime = null;
    resetBrowserSession("unloaded", null, {}, "{}", {});
    return browserSessionInfo();
  }
}

export async function readConfig(filename: string): Promise<string> {
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    return invoke<string>("read_config", { filename });
  }
  if (browserSession.kind === "server-backed") {
    if (filename === OPENCODE_FILE) {
      const data = await apiJson<{ content: string }>("/api/config/opencode");
      return data.content;
    }
    if (filename === OH_MY_LEGACY_FILE || filename === OH_MY_MODERN_FILE) {
      const data = await apiJson<{ content: string }>("/api/config/oh-my");
      return data.content;
    }
  }
  return readBrowserConfig(filename);
}

export async function writeConfig(filename: string, content: string): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    await invoke("write_config", { filename, content });
    return;
  }
  if (browserSession.kind === "server-backed") {
    if (filename === OPENCODE_FILE) {
      await apiJson<{ ok: true }>("/api/config/opencode", {
        method: "PUT",
        body: JSON.stringify({ content }),
      });
      browserSession.dirty = false;
      return;
    }
    if (filename === OH_MY_LEGACY_FILE || filename === OH_MY_MODERN_FILE) {
      await apiJson<{ ok: true }>("/api/config/oh-my", {
        method: "PUT",
        body: JSON.stringify({ content }),
      });
      browserSession.dirty = false;
      return;
    }
  }
  writeBrowserSessionFile(filename, content);
}

export async function readAuth(): Promise<string> {
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    return invoke<string>("read_auth");
  }
  if (browserSession.kind === "server-backed") {
    const data = await apiJson<{ content: string }>("/api/auth");
    browserSession.auth = data.content;
    return data.content;
  }
  return browserSession.auth;
}

export function getBrowserConfigSessionInfo(): BrowserConfigSessionInfo {
  if (isTauriRuntime()) {
    return {
      kind: "file-backed",
      dirty: false,
      canSaveToDisk: true,
      sourceName: null,
      loadedFiles: [],
      hasAuth: false,
    };
  }
  clearLegacyBrowserConfigKeys();
  return browserSessionInfo();
}

export function hasBrowserFileSystemAccess(): boolean {
  if (isTauriRuntime()) return false;
  const fsWindow = browserWindow();
  return !!fsWindow.showOpenFilePicker || !!fsWindow.showDirectoryPicker;
}

export async function loadBrowserConfigFiles(): Promise<BrowserConfigSessionInfo> {
  if (isTauriRuntime()) return getBrowserConfigSessionInfo();
  const picker = browserWindow().showOpenFilePicker;
  if (!picker) {
    throw new Error("This browser does not support file picking. Use Import JSON instead.");
  }
  const handles = await picker({ multiple: true, types: CONFIG_JSON_TYPES });
  const files: Partial<Record<BrowserConfigFilename, string>> = {};
  let auth = "{}";
  for (const handle of handles) {
    const content = await (await handle.getFile()).text();
    const filename = normalizeBrowserConfigFilename(handle.name);
    if (filename) files[filename] = content;
    if (handle.name === AUTH_FILE) auth = content;
  }
  if (!files[OPENCODE_FILE] && !files[OH_MY_MODERN_FILE] && !files[OH_MY_LEGACY_FILE]) {
    throw new Error("Select opencode.json and/or oh-my-openagent.json to start a browser session.");
  }
  resetBrowserSession(
    "imported",
    handles.map((handle) => handle.name).join(", "),
    files,
    auth,
  );
  return browserSessionInfo();
}

export async function loadBrowserConfigDirectory(): Promise<BrowserConfigSessionInfo> {
  if (isTauriRuntime()) return getBrowserConfigSessionInfo();
  const picker = browserWindow().showDirectoryPicker;
  if (!picker) {
    throw new Error("This browser does not support directory access. Use file import/export instead.");
  }
  const directory = await picker();
  const opencode = await readHandleIfExists(directory, OPENCODE_FILE);
  const modernOhMy = await readHandleIfExists(directory, OH_MY_MODERN_FILE);
  const legacyOhMy = modernOhMy ? null : await readHandleIfExists(directory, OH_MY_LEGACY_FILE);
  const auth = await readHandleIfExists(directory, AUTH_FILE);
  if (!opencode && !modernOhMy && !legacyOhMy) {
    throw new Error("The selected folder does not contain opencode.json or an oh-my config file.");
  }
  const files: Partial<Record<BrowserConfigFilename, string>> = {};
  const fileHandles: BrowserConfigSession["fileHandles"] = {};
  if (opencode) {
    files[OPENCODE_FILE] = opencode.content;
    fileHandles[OPENCODE_FILE] = opencode.handle;
  }
  if (modernOhMy) {
    files[OH_MY_MODERN_FILE] = modernOhMy.content;
    fileHandles[OH_MY_MODERN_FILE] = modernOhMy.handle;
  } else if (legacyOhMy) {
    files[OH_MY_LEGACY_FILE] = legacyOhMy.content;
  }
  resetBrowserSession(
    "file-backed",
    directory.name,
    files,
    auth?.content ?? "{}",
    fileHandles,
  );
  return browserSessionInfo();
}

export function importBrowserConfigFromText(
  filename: string,
  content: string,
): BrowserConfigSessionInfo {
  if (isTauriRuntime()) return getBrowserConfigSessionInfo();
  const normalized = normalizeBrowserConfigFilename(filename);
  if (!normalized && filename !== AUTH_FILE) {
    throw new Error(`Unsupported browser import filename: ${filename}`);
  }
  const files = { ...browserSession.files };
  const auth = filename === AUTH_FILE ? content : browserSession.auth;
  if (normalized) files[normalized] = content;
  const sourceName = browserSession.sourceName
    ? `${browserSession.sourceName}, ${filename}`
    : filename;
  resetBrowserSession("imported", sourceName, files, auth);
  return browserSessionInfo();
}

export function createBrowserConfigSession(): BrowserConfigSessionInfo {
  if (isTauriRuntime()) return getBrowserConfigSessionInfo();
  resetBrowserSession(
    "imported",
    "New browser session",
    {
      [OPENCODE_FILE]: browserInitialOpenCode,
      [OH_MY_MODERN_FILE]: browserInitialOhMy,
    },
    "{}",
  );
  browserSession.dirty = true;
  return browserSessionInfo();
}

export async function saveBrowserConfigSession(): Promise<BrowserConfigSessionInfo> {
  if (isTauriRuntime()) return getBrowserConfigSessionInfo();
  if (browserSession.kind === "unloaded") {
    throw new Error("Browser configuration is not loaded.");
  }
  if (browserSession.kind === "server-backed") {
    throw new Error("Server-backed sessions save real files immediately through the local API.");
  }
  if (!browserSession.fileHandles[OPENCODE_FILE]) {
    throw new Error("This browser session is not backed by opencode.json. Export instead.");
  }
  let ohMyHandle = browserSession.fileHandles[OH_MY_MODERN_FILE];
  if (!ohMyHandle) {
    const picker = browserWindow().showSaveFilePicker;
    if (!picker) throw new Error("Choose Export because this browser cannot save files directly.");
    ohMyHandle = await picker({ suggestedName: OH_MY_MODERN_FILE, types: CONFIG_JSON_TYPES });
    browserSession.fileHandles[OH_MY_MODERN_FILE] = ohMyHandle;
  }
  const writes: Array<[BrowserFileHandle, string]> = [
    [browserSession.fileHandles[OPENCODE_FILE], readBrowserConfig(OPENCODE_FILE)],
    [ohMyHandle, readBrowserConfig(OH_MY_MODERN_FILE)],
  ];
  for (const [handle, content] of writes) {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }
  browserSession.loadedFiles.add(OPENCODE_FILE);
  browserSession.loadedFiles.add(OH_MY_MODERN_FILE);
  browserSession.dirty = false;
  return browserSessionInfo();
}

export function exportBrowserConfigSession(): BrowserConfigSessionInfo {
  if (isTauriRuntime()) return getBrowserConfigSessionInfo();
  if (browserSession.kind === "unloaded") {
    throw new Error("Browser configuration is not loaded.");
  }
  if (browserSession.kind === "server-backed") {
    throw new Error("Server-backed sessions already operate on real server files. Use snapshots or your browser download flow if you need exports.");
  }
  downloadJson(OPENCODE_FILE, readBrowserConfig(OPENCODE_FILE));
  downloadJson(OH_MY_MODERN_FILE, readBrowserConfig(OH_MY_MODERN_FILE));
  browserSession.dirty = false;
  return browserSessionInfo();
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
  if (browserSession.kind === "server-backed") {
    const data = await apiJson<{ items: SnapshotInfo[] }>("/api/snapshots");
    return data.items;
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
  if (browserSession.kind === "server-backed") {
    await apiJson<{ ok: true }>("/api/snapshots", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return;
  }
  if (browserSession.kind === "unloaded") {
    throw new Error("Load or create a browser config session before saving snapshots.");
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
      [OH_MY_MODERN_FILE]: readBrowserConfig(OH_MY_MODERN_FILE),
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
  if (browserSession.kind === "server-backed") {
    await apiJson<{ ok: true }>(`/api/snapshots/${encodeURIComponent(name)}/restore`, {
      method: "POST",
    });
    browserSession.dirty = false;
    return;
  }
  const snapshot = readBrowserSnapshots().find((item) => item.name === name);
  if (!snapshot) throw new Error(`Snapshot ${name} does not exist`);
  const files: Partial<Record<BrowserConfigFilename, string>> = {};
  if (snapshot.files[OPENCODE_FILE]) files[OPENCODE_FILE] = snapshot.files[OPENCODE_FILE];
  const ohMyContent = snapshot.files[OH_MY_MODERN_FILE] ?? snapshot.files[OH_MY_LEGACY_FILE];
  if (ohMyContent) files[OH_MY_MODERN_FILE] = ohMyContent;
  resetBrowserSession("imported", `Snapshot ${name}`, files, "{}");
  browserSession.dirty = true;
}

export async function deleteSnapshot(name: string): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await loadTauriCore();
    await invoke("delete_snapshot", { name });
    return;
  }
  if (browserSession.kind === "server-backed") {
    await apiJson<{ ok: true }>(`/api/snapshots/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
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
  if (browserSession.kind === "server-backed") {
    await apiJson<{ ok: true }>(`/api/snapshots/${encodeURIComponent(from)}/rename`, {
      method: "POST",
      body: JSON.stringify({ to }),
    });
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
  if (browserSession.kind === "server-backed") {
    const data = await apiJson<{ content: string }>(`/api/snapshots/${encodeURIComponent(name)}/export`);
    return data.content;
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
  if (browserSession.kind === "server-backed") {
    const data = await apiJson<{ items: SkillSummary[] }>("/api/skills");
    return data.items;
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
  if (browserSession.kind === "server-backed") {
    const data = await apiJson<{ detail: SkillDetail }>(`/api/skills/${encodeURIComponent(name)}`);
    return data.detail;
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
  if (browserSession.kind === "server-backed") {
    await apiJson<{ ok: true }>("/api/skills", {
      method: "POST",
      body: JSON.stringify({ name, content }),
    });
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
  if (browserSession.kind === "server-backed") {
    await apiJson<{ ok: true }>(`/api/skills/${encodeURIComponent(name)}/files/${encodeURIComponent(path)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    });
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

export function describeBrowserLimitations(
  auth: AuthConfig,
  session: BrowserConfigSessionInfo = browserSessionInfo(),
): string | null {
  if (isTauriRuntime()) return null;
  if (session.kind === "unloaded") {
    return "Browser mode starts unloaded. Import config files or open a config folder before editing.";
  }
  if (session.kind === "server-backed") {
    return "Browser mode is connected to the local config API and reads/writes the real server config files on WSL/Linux.";
  }
  if (Object.keys(auth).length === 0) {
    return "Browser mode did not load auth.json. It will not pretend to have desktop credentials; connected provider models require an explicit auth.json import or provider model entries.";
  }
  return "Browser mode fetches external provider models directly from the browser, so some providers may be limited by CORS or network policy.";
}
