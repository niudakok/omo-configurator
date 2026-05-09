import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type {
  OpenCodeConfig,
  OhMyOpenCodeConfig,
  AgentConfig,
  CategoryConfig,
  McpServer,
  Provider,
  ConfigFileType,
  AuthConfig,
} from "@/types/config";
import {
  parseOpenCodeConfig,
  parseOhMyOpenCodeConfig,
  serializeConfig,
} from "@/lib/config";
import { fetchExternalProviderModels } from "@/lib/providers";
import {
  createBrowserConfigSession,
  describeBrowserLimitations,
  exportBrowserConfigSession,
  getBrowserConfigSessionInfo,
  getRuntimeMode,
  importBrowserConfigFromText,
  initializeBrowserRuntime,
  initializeBrowserRuntimeSession,
  loadBrowserConfigDirectory,
  loadBrowserConfigFiles,
  readAuth,
  readConfig,
  saveBrowserConfigSession,
  writeConfig,
  type BrowserConfigSessionInfo,
} from "@/lib/runtime";

interface ConfigState {
  openCodeConfig: OpenCodeConfig | null;
  ohMyOpenCodeConfig: OhMyOpenCodeConfig | null;
  authConfig: AuthConfig | null;
  /** 从 auth.json 连接的内置/外部 provider 拉取到的模型列表 */
  externalModels: string[];
  activeFile: ConfigFileType;
  browserSession: BrowserConfigSessionInfo | null;
  saveState: "idle" | "saving" | "saved" | "error";
  loading: boolean;
  error: string | null;
}

type ConfigAction =
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_SAVE_STATE"; saveState: ConfigState["saveState"] }
  | { type: "SET_ERROR"; error: string }
  | { type: "SET_OPENCODE"; config: OpenCodeConfig }
  | { type: "SET_OH_MY"; config: OhMyOpenCodeConfig }
  | { type: "SET_ACTIVE_FILE"; file: ConfigFileType }
  | { type: "SET_BROWSER_SESSION"; session: BrowserConfigSessionInfo }
  | { type: "SET_BOTH"; openCode: OpenCodeConfig; ohMy: OhMyOpenCodeConfig; auth: AuthConfig }
  | { type: "CLEAR_CONFIG"; session: BrowserConfigSessionInfo | null }
  | { type: "SET_EXTERNAL_MODELS"; models: string[] };

function configReducer(state: ConfigState, action: ConfigAction): ConfigState {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "SET_SAVE_STATE":
      return { ...state, saveState: action.saveState };
    case "SET_ERROR":
      return { ...state, error: action.error, loading: false, saveState: "error" };
    case "SET_OPENCODE":
      return { ...state, openCodeConfig: action.config };
    case "SET_OH_MY":
      return { ...state, ohMyOpenCodeConfig: action.config };
    case "SET_ACTIVE_FILE":
      return { ...state, activeFile: action.file };
    case "SET_BROWSER_SESSION":
      return { ...state, browserSession: action.session };
    case "SET_BOTH":
      return {
        ...state,
        openCodeConfig: action.openCode,
        ohMyOpenCodeConfig: action.ohMy,
        authConfig: action.auth,
        browserSession: getRuntimeMode() === "browser" ? getBrowserConfigSessionInfo() : null,
        saveState: "idle",
        loading: false,
        error: null,
      };
    case "CLEAR_CONFIG":
      return {
        ...state,
        openCodeConfig: null,
        ohMyOpenCodeConfig: null,
        authConfig: null,
        externalModels: [],
        browserSession: action.session,
        saveState: "idle",
        loading: false,
        error: null,
      };
    case "SET_EXTERNAL_MODELS":
      return { ...state, externalModels: action.models };
    default:
      return state;
  }
}

interface ConfigContextValue extends ConfigState {
  reload: () => Promise<void>;
  setActiveFile: (file: ConfigFileType) => void;
  /** 手动触发重新拉取外部 provider 模型（例如新连接了 provider 后） */
  refreshExternalModels: () => Promise<void>;
  updateAgent: (name: string, config: AgentConfig) => void;
  updateCategory: (name: string, config: CategoryConfig) => void;
  updateMcpServer: (name: string, server: McpServer) => void;
  deleteMcpServer: (name: string) => void;
  updateProvider: (name: string, provider: Provider) => void;
  deleteProvider: (name: string) => void;
  batchReplaceModel: (
    fromModel: string,
    toModel: string,
    toVariant?: string,
  ) => void;
  updatePluginVersion: (pluginName: string, newVersion: string) => void;
  loadBrowserFiles: () => Promise<void>;
  loadBrowserDirectory: () => Promise<void>;
  importBrowserFile: (file: File) => Promise<void>;
  createNewBrowserSession: () => Promise<void>;
  saveBrowserSession: () => Promise<void>;
  exportBrowserSession: () => Promise<void>;
  runWithSaveStatus: <T>(persist: () => Promise<T>) => Promise<T | undefined>;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

async function persistOhMy(config: OhMyOpenCodeConfig) {
  await writeConfig("oh-my-openagent.json", serializeConfig(config));
}

async function persistOpenCode(config: OpenCodeConfig) {
  await writeConfig("opencode.json", serializeConfig(config));
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  if (getRuntimeMode() === "browser") {
    initializeBrowserRuntime();
  }

  const [state, dispatch] = useReducer(configReducer, {
    openCodeConfig: null,
    ohMyOpenCodeConfig: null,
    authConfig: null,
    externalModels: [],
    activeFile: "oh-my-opencode",
    browserSession: getRuntimeMode() === "browser" ? getBrowserConfigSessionInfo() : null,
    saveState: "idle",
    loading: getRuntimeMode() === "tauri" || getRuntimeMode() === "browser",
    error: null,
  });

  const markSavedSoon = useCallback(() => {
    dispatch({ type: "SET_SAVE_STATE", saveState: "saved" });
    window.setTimeout(() => {
      dispatch({ type: "SET_SAVE_STATE", saveState: "idle" });
    }, 1800);
  }, []);

  const persistWithStatus = useCallback(
    async <T,>(persist: () => Promise<T>) => {
      dispatch({ type: "SET_SAVE_STATE", saveState: "saving" });
      try {
        const result = await persist();
        markSavedSoon();
        return result;
      } catch (caught) {
        dispatch({
          type: "SET_ERROR",
          error: caught instanceof Error ? caught.message : String(caught),
        });
      }
    },
    [markSavedSoon],
  );

  const reload = useCallback(async () => {
    const browserInfo = getRuntimeMode() === "browser" ? getBrowserConfigSessionInfo() : null;
    if (browserInfo?.kind === "unloaded") {
      dispatch({ type: "CLEAR_CONFIG", session: browserInfo });
      return;
    }
    dispatch({ type: "SET_LOADING", loading: true });
    try {
      const ocRaw = await readConfig("opencode.json");
      const omRaw = await readConfig("oh-my-opencode.json");
      const authRaw = await readAuth();
      const oc = parseOpenCodeConfig(ocRaw);
      const auth = JSON.parse(authRaw) as AuthConfig;
      dispatch({
        type: "SET_BOTH",
        openCode: oc,
        ohMy: parseOhMyOpenCodeConfig(omRaw),
        auth,
      });
      // 异步拉取外部模型，不阻塞 UI 渲染
      void fetchExternalProviderModels(auth, oc).then((models) => {
        dispatch({ type: "SET_EXTERNAL_MODELS", models });
      });
      const limitation = describeBrowserLimitations(auth, getBrowserConfigSessionInfo());
      if (limitation) console.info(`[runtime] ${limitation}`);
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: String(e) });
    }
  }, []);

  const refreshExternalModels = useCallback(async () => {
    if (!state.authConfig) return;
    const models = await fetchExternalProviderModels(state.authConfig, state.openCodeConfig);
    dispatch({ type: "SET_EXTERNAL_MODELS", models });
  }, [state.authConfig, state.openCodeConfig]);

  useEffect(() => {
    if (getRuntimeMode() === "tauri") {
      void reload();
      return;
    }
    let active = true;
    void (async () => {
      const session = await initializeBrowserRuntimeSession();
      if (!active) return;
      dispatch({ type: "SET_BROWSER_SESSION", session });
      if (session.kind === "unloaded") {
        dispatch({ type: "CLEAR_CONFIG", session });
        return;
      }
      await reload();
    })();
    return () => {
      active = false;
    };
  }, [reload]);

  const withBrowserSessionReload = useCallback(
    async (loadSession: () => Promise<BrowserConfigSessionInfo> | BrowserConfigSessionInfo) => {
      dispatch({ type: "SET_LOADING", loading: true });
      try {
        const session = await loadSession();
        dispatch({ type: "SET_BROWSER_SESSION", session });
        await reload();
      } catch (caught) {
        dispatch({
          type: "SET_ERROR",
          error: caught instanceof Error ? caught.message : String(caught),
        });
      }
    },
    [reload],
  );

  const loadBrowserFiles = useCallback(async () => {
    await withBrowserSessionReload(loadBrowserConfigFiles);
  }, [withBrowserSessionReload]);

  const loadBrowserDirectory = useCallback(async () => {
    await withBrowserSessionReload(loadBrowserConfigDirectory);
  }, [withBrowserSessionReload]);

  const importBrowserFile = useCallback(
    async (file: File) => {
      await withBrowserSessionReload(async () =>
        importBrowserConfigFromText(file.name, await file.text()),
      );
    },
    [withBrowserSessionReload],
  );

  const createNewBrowserSession = useCallback(async () => {
    await withBrowserSessionReload(createBrowserConfigSession);
  }, [withBrowserSessionReload]);

  const saveBrowserSessionAction = useCallback(async () => {
    const session = await saveBrowserConfigSession();
    dispatch({ type: "SET_BROWSER_SESSION", session });
  }, []);

  const exportBrowserSessionAction = useCallback(async () => {
    const session = exportBrowserConfigSession();
    dispatch({ type: "SET_BROWSER_SESSION", session });
  }, []);

  const setActiveFile = useCallback((file: ConfigFileType) => {
    dispatch({ type: "SET_ACTIVE_FILE", file });
  }, []);

  const updateAgent = useCallback(
    (name: string, config: AgentConfig) => {
      if (!state.ohMyOpenCodeConfig) return;
      const updated: OhMyOpenCodeConfig = {
        ...state.ohMyOpenCodeConfig,
        agents: { ...state.ohMyOpenCodeConfig.agents, [name]: config },
      };
      dispatch({ type: "SET_OH_MY", config: updated });
      void persistWithStatus(() => persistOhMy(updated));
      if (getRuntimeMode() === "browser") {
        dispatch({ type: "SET_BROWSER_SESSION", session: getBrowserConfigSessionInfo() });
      }
    },
    [state.ohMyOpenCodeConfig],
  );

  const updateCategory = useCallback(
    (name: string, config: CategoryConfig) => {
      if (!state.ohMyOpenCodeConfig) return;
      const updated: OhMyOpenCodeConfig = {
        ...state.ohMyOpenCodeConfig,
        categories: { ...state.ohMyOpenCodeConfig.categories, [name]: config },
      };
      dispatch({ type: "SET_OH_MY", config: updated });
      void persistWithStatus(() => persistOhMy(updated));
      if (getRuntimeMode() === "browser") {
        dispatch({ type: "SET_BROWSER_SESSION", session: getBrowserConfigSessionInfo() });
      }
    },
    [state.ohMyOpenCodeConfig],
  );

  const updateMcpServer = useCallback(
    (name: string, server: McpServer) => {
      if (!state.openCodeConfig) return;
      const updated: OpenCodeConfig = {
        ...state.openCodeConfig,
        mcp: { ...state.openCodeConfig.mcp, [name]: server },
      };
      dispatch({ type: "SET_OPENCODE", config: updated });
      void persistWithStatus(() => persistOpenCode(updated));
      if (getRuntimeMode() === "browser") {
        dispatch({ type: "SET_BROWSER_SESSION", session: getBrowserConfigSessionInfo() });
      }
    },
    [state.openCodeConfig],
  );

  const deleteMcpServer = useCallback(
    (name: string) => {
      if (!state.openCodeConfig?.mcp) return;
      const mcp = { ...state.openCodeConfig.mcp };
      delete mcp[name];
      const updated: OpenCodeConfig = {
        ...state.openCodeConfig,
        mcp,
      };
      dispatch({ type: "SET_OPENCODE", config: updated });
      void persistWithStatus(() => persistOpenCode(updated));
      if (getRuntimeMode() === "browser") {
        dispatch({ type: "SET_BROWSER_SESSION", session: getBrowserConfigSessionInfo() });
      }
    },
    [state.openCodeConfig],
  );

  const updateProvider = useCallback(
    (name: string, provider: Provider) => {
      if (!state.openCodeConfig) return;
      const updated: OpenCodeConfig = {
        ...state.openCodeConfig,
        provider: { ...state.openCodeConfig.provider, [name]: provider },
      };
      dispatch({ type: "SET_OPENCODE", config: updated });
      void persistWithStatus(() => persistOpenCode(updated));
      if (getRuntimeMode() === "browser") {
        dispatch({ type: "SET_BROWSER_SESSION", session: getBrowserConfigSessionInfo() });
      }
    },
    [state.openCodeConfig],
  );

  const deleteProvider = useCallback(
    (name: string) => {
      if (!state.openCodeConfig?.provider) return;
      const provider = { ...state.openCodeConfig.provider };
      delete provider[name];
      const updated: OpenCodeConfig = {
        ...state.openCodeConfig,
        provider,
      };
      dispatch({ type: "SET_OPENCODE", config: updated });
      void persistWithStatus(() => persistOpenCode(updated));
      if (getRuntimeMode() === "browser") {
        dispatch({ type: "SET_BROWSER_SESSION", session: getBrowserConfigSessionInfo() });
      }
    },
    [state.openCodeConfig],
  );

  const batchReplaceModel = useCallback(
    (fromModel: string, toModel: string, toVariant?: string) => {
      if (!state.ohMyOpenCodeConfig) return;
      const updated: OhMyOpenCodeConfig = {
        ...state.ohMyOpenCodeConfig,
        agents: { ...state.ohMyOpenCodeConfig.agents },
        categories: { ...state.ohMyOpenCodeConfig.categories },
      };
      if (updated.agents) {
        for (const [agentName, agent] of Object.entries(updated.agents)) {
          if (agent.model === fromModel) {
            updated.agents[agentName] = { model: toModel, variant: toVariant };
          }
        }
      }
      if (updated.categories) {
        for (const [catName, cat] of Object.entries(updated.categories)) {
          if (cat.model === fromModel) {
            updated.categories[catName] = {
              model: toModel,
              variant: toVariant,
            };
          }
        }
      }
      dispatch({ type: "SET_OH_MY", config: updated });
      void persistWithStatus(() => persistOhMy(updated));
      if (getRuntimeMode() === "browser") {
        dispatch({ type: "SET_BROWSER_SESSION", session: getBrowserConfigSessionInfo() });
      }
    },
    [state.ohMyOpenCodeConfig],
  );

  const updatePluginVersion = useCallback(
    (pluginName: string, newVersion: string) => {
      if (!state.openCodeConfig) return;
      const updated: OpenCodeConfig = {
        ...state.openCodeConfig,
        plugin: state.openCodeConfig.plugin?.map((p) => {
          if (typeof p === "string" && p.startsWith(pluginName + "@")) {
            return `${pluginName}@${newVersion}`;
          }
          return p;
        }),
      };
      dispatch({ type: "SET_OPENCODE", config: updated });
      void persistWithStatus(() => persistOpenCode(updated));
      if (getRuntimeMode() === "browser") {
        dispatch({ type: "SET_BROWSER_SESSION", session: getBrowserConfigSessionInfo() });
      }
    },
    [state.openCodeConfig],
  );

  return (
    <ConfigContext.Provider
      value={{
        ...state,
        reload,
        setActiveFile,
        refreshExternalModels,
        updateAgent,
        updateCategory,
        updateMcpServer,
        deleteMcpServer,
        updateProvider,
        deleteProvider,
        batchReplaceModel,
        updatePluginVersion,
        loadBrowserFiles,
        loadBrowserDirectory,
        importBrowserFile,
        createNewBrowserSession,
        saveBrowserSession: saveBrowserSessionAction,
        exportBrowserSession: exportBrowserSessionAction,
        runWithSaveStatus: persistWithStatus,
      }}
    >
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig(): ConfigContextValue {
  const context = useContext(ConfigContext);
  if (!context) {
    throw new Error("useConfig 必须在 ConfigProvider 内使用");
  }
  return context;
}
