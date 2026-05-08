import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TopBar } from "@/components/layout/TopBar";
import { TabBar, type TabValue } from "@/components/layout/TabBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { AgentTable } from "@/components/agents/AgentTable";
import { CategoryTable } from "@/components/agents/CategoryTable";
import { BatchModelBar } from "@/components/agents/BatchModelBar";
import { McpList } from "@/components/mcp/McpList";
import { ProviderList } from "@/components/provider/ProviderList";
import { SkillsManager } from "@/components/skills/SkillsManager";
import { useConfig } from "@/context/ConfigContext";
import { getRuntimeMode } from "@/lib/runtime";
import { Button } from "@/components/ui/button";

export default function App() {
  const [tab, setTab] = useState<TabValue>("agents");
  const {
    loading,
    error,
    browserSession,
    loadBrowserFiles,
    loadBrowserDirectory,
    importBrowserFile,
    createNewBrowserSession,
  } = useConfig();
  const { t } = useTranslation("common");
  const importInputRef = useRef<HTMLInputElement>(null);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">{t("app.loading")}</p>
      </div>
    );
  }

  if (error && !(getRuntimeMode() === "browser" && browserSession?.kind === "unloaded")) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-destructive font-medium">{t("app.loadError")}</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (getRuntimeMode() === "browser" && browserSession?.kind === "unloaded") {
    return (
      <div className="flex h-screen flex-col">
        <TopBar />
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-xl rounded-lg border bg-card p-6 text-center shadow-sm space-y-4">
            <div>
              <h2 className="text-lg font-semibold">{t("browserSession.unloadedTitle")}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("browserSession.unloadedDescription")}
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => void loadBrowserDirectory()}>
                {t("browserSession.openFolder")}
              </Button>
              <Button variant="outline" onClick={() => void loadBrowserFiles()}>
                {t("browserSession.openFiles")}
              </Button>
              <Button variant="outline" onClick={() => importInputRef.current?.click()}>
                {t("browserSession.importFile")}
              </Button>
              <Button variant="ghost" onClick={() => void createNewBrowserSession()}>
                {t("browserSession.newSession")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("browserSession.fallbackHint")}</p>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void importBrowserFile(file);
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="px-4 pt-3">
            <TabBar value={tab} onValueChange={setTab} />
          </div>
          <div className="flex-1 overflow-auto p-4">
            {tab === "agents" && (
              <div className="space-y-6">
                <BatchModelBar />
                <AgentTable />
                <CategoryTable />
              </div>
            )}
            {tab === "mcp" && <McpList />}
            {tab === "providers" && <ProviderList />}
            {tab === "skills" && <SkillsManager />}
          </div>
        </div>
      </div>
    </div>
  );
}
