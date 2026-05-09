import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LanguageSwitcher } from "@/components/shared/LanguageSwitcher";
import { useConfig } from "@/context/ConfigContext";
import { getOhMyOpenCodeVersion } from "@/lib/config";
import { describeBrowserLimitations, getAppVersion, getRuntimeMode } from "@/lib/runtime";

export function TopBar() {
  const {
    openCodeConfig,
    updatePluginVersion,
    externalModels,
    authConfig,
    refreshExternalModels,
    browserSession,
    loadBrowserFiles,
    loadBrowserDirectory,
    importBrowserFile,
    saveBrowserSession,
    exportBrowserSession,
  } = useConfig();
  const { t } = useTranslation("common");
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getAppVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(null));
  }, []);

  const browserLimitation = browserSession
    ? describeBrowserLimitations(authConfig ?? {}, browserSession)
    : null;
  const browserStatus = browserSession
    ? t(`browserSession.status.${browserSession.kind}`) +
      (browserSession.dirty ? ` · ${t("browserSession.status.dirty")}` : "")
    : null;

  const runSessionAction = async (action: () => Promise<void>) => {
    setSessionBusy(true);
    try {
      await action();
    } finally {
      setSessionBusy(false);
    }
  };

  const currentVersion = openCodeConfig
    ? getOhMyOpenCodeVersion(openCodeConfig)
    : undefined;

  const checkUpdate = async () => {
    setChecking(true);
    try {
      const res = await fetch(
        "https://registry.npmjs.org/oh-my-openagent/latest",
      );
      const data = (await res.json()) as { version: string };
      setLatestVersion(data.version);
    } catch {
      setLatestVersion(null);
    } finally {
      setChecking(false);
    }
  };

  const hasUpdate =
    latestVersion && currentVersion && latestVersion !== currentVersion;

  return (
    <div className="flex items-center justify-between border-b px-4 py-2 bg-background">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{t("app.name")}</h1>
        {appVersion && (
          <Badge variant="secondary" title={t("app.appVersionTitle")}>
            v{appVersion}
          </Badge>
        )}
        {getRuntimeMode() === "browser" && (
          <Badge
            variant="outline"
            title={
              browserLimitation ??
              t("app.browserModeTitle", { source: browserSession?.sourceName ?? "" })
            }
          >
            {browserStatus ?? t("app.browserMode")}
          </Badge>
        )}
        {currentVersion && (
          <Badge variant="secondary" title={t("app.pluginVersionTitle")}>
            oh-my-openagent v{currentVersion}
          </Badge>
        )}
        {hasUpdate && (
          <Badge
            variant="outline"
            className="cursor-pointer text-orange-600 border-orange-300"
            onClick={() =>
              updatePluginVersion("oh-my-openagent", latestVersion!)
            }
          >
            {t("app.updateAvailable", { version: latestVersion })}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        {getRuntimeMode() === "browser" && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runSessionAction(loadBrowserDirectory)}
              disabled={sessionBusy}
            >
              {t("browserSession.openFolderShort")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runSessionAction(loadBrowserFiles)}
              disabled={sessionBusy}
            >
              {t("browserSession.openFilesShort")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => importInputRef.current?.click()}
              disabled={sessionBusy}
            >
              {t("browserSession.importShort")}
            </Button>
             {browserSession?.canSaveToDisk && browserSession.kind !== "server-backed" && (
               <Button
                 variant="default"
                 size="sm"
                onClick={() => void runSessionAction(saveBrowserSession)}
                disabled={sessionBusy || !browserSession.dirty}
              >
                {t("browserSession.saveToFiles")}
              </Button>
            )}
             {browserSession?.kind === "server-backed" && (
               <Button variant="default" size="sm" disabled>
                 {t("browserSession.serverBackedActive")}
               </Button>
             )}
             {browserSession && browserSession.kind !== "unloaded" && browserSession.kind !== "server-backed" && (
               <Button
                 variant="outline"
                 size="sm"
                onClick={() => void runSessionAction(exportBrowserSession)}
                disabled={sessionBusy}
              >
                {t("browserSession.exportFiles")}
              </Button>
            )}
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void runSessionAction(() => importBrowserFile(file));
              }}
            />
          </>
        )}
        {authConfig && Object.keys(authConfig).length > 0 && (
          <Badge
            variant="secondary"
            className="cursor-pointer text-xs"
            title={t("app.connectedProviders", {
              names: Object.keys(authConfig).join(", "),
            })}
            onClick={() => void refreshExternalModels()}
          >
            {externalModels.length > 0
              ? t("app.externalModelsLoaded", { count: externalModels.length })
              : t("app.externalModelsLoading")}
          </Badge>
        )}
        <LanguageSwitcher />
        <Button
          variant="outline"
          size="sm"
          onClick={checkUpdate}
          disabled={checking}
        >
          {checking ? t("app.checking") : t("app.checkUpdate")}
        </Button>
      </div>
    </div>
  );
}
