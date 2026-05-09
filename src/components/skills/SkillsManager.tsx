import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfig } from "@/context/ConfigContext";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  createSkill,
  getBrowserConfigSessionInfo,
  getRuntimeMode,
  listSkills,
  readSkill,
  writeSkillFile,
  type SkillDetail,
  type SkillSummary,
} from "@/lib/runtime";

const DEFAULT_SKILL_CONTENT = `# New Skill

Describe when to use this skill and the workflow it enables.
`;

function formatDate(timestamp: number): string {
  if (timestamp === 0) return "-";
  return new Date(timestamp * 1000).toLocaleString();
}

export function SkillsManager() {
  const { t } = useTranslation(["skills", "common"]);
  const { runWithSaveStatus } = useConfig();
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [selectedFile, setSelectedFile] = useState("SKILL.md");
  const [draft, setDraft] = useState("");
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runtimeMode = getRuntimeMode();
  const browserSession = runtimeMode === "browser" ? getBrowserConfigSessionInfo() : null;
  const currentFile = useMemo(
    () => detail?.files.find((file) => file.path === selectedFile) ?? null,
    [detail, selectedFile],
  );

  const refreshList = async () => {
    const nextSkills = await listSkills();
    setSkills(nextSkills);
    if (!selected && nextSkills[0]) setSelected(nextSkills[0].name);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    refreshList()
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setDraft("");
      return;
    }
    let active = true;
    readSkill(selected)
      .then((nextDetail) => {
        if (!active) return;
        setDetail(nextDetail);
        const primaryFile =
          nextDetail.files.find((file) => file.path === selectedFile) ??
          nextDetail.files.find((file) => file.path === "SKILL.md") ??
          nextDetail.files[0] ??
          null;
        setSelectedFile(primaryFile?.path ?? "SKILL.md");
        setDraft(primaryFile?.content ?? "");
        setError(null);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      active = false;
    };
  }, [selected]);

  useEffect(() => {
    setDraft(currentFile?.content ?? "");
  }, [currentFile]);

  const handleCreate = async () => {
    setSaving(true);
    setError(null);
    try {
      const name = newName.trim();
      await runWithSaveStatus(() => createSkill(name, DEFAULT_SKILL_CONTENT));
      setNewName("");
      setSelected(name);
      await refreshList();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await runWithSaveStatus(() => writeSkillFile(selected, selectedFile, draft));
      const nextDetail = await readSkill(selected);
      setDetail(nextDetail);
      await refreshList();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full gap-4">
      <div className="w-64 flex flex-col gap-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("create.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              placeholder={t("create.placeholder")}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <Button size="sm" onClick={handleCreate} disabled={saving || !newName.trim()}>
              {t("create.button")}
            </Button>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t("title")}</h3>
          <Badge variant={runtimeMode === "tauri" ? "default" : "secondary"}>
            {runtimeMode === "tauri" ? t("mode.tauri") : t("mode.browser")}
          </Badge>
        </div>
        <ScrollArea className="flex-1 rounded-md border">
          <div className="p-1">
            {skills.map((skill) => (
              <button
                key={skill.name}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  selected === skill.name ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                }`}
                onClick={() => setSelected(skill.name)}
              >
                <span className="block font-mono">{skill.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t("list.fileCount", { count: skill.files.length })}
                </span>
              </button>
            ))}
            {!loading && skills.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground">{t("empty")}</p>
            )}
          </div>
        </ScrollArea>
      </div>

      <Separator orientation="vertical" />

      <div className="flex-1 overflow-auto">
        <div className="mb-3 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            {runtimeMode === "tauri"
              ? t("description.tauri")
              : browserSession?.kind === "server-backed"
                ? t("description.serverBacked")
                : t("description.browser")}
        </div>
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        {detail ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-mono text-base font-medium">{detail.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {t("detail.updated", { date: formatDate(detail.updated_at) })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {detail.files.map((file) => (
                  <Button
                    key={file.path}
                    size="sm"
                    variant={selectedFile === file.path ? "default" : "outline"}
                    onClick={() => setSelectedFile(file.path)}
                  >
                    {file.path}
                  </Button>
                ))}
              </div>
            </div>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="font-mono text-sm">{selectedFile}</CardTitle>
                  <Button size="sm" onClick={handleSave} disabled={saving || !selected}>
                    {saving ? t("common:app.checking") : t("common:actions.save")}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Textarea
                  className="min-h-[420px] font-mono text-sm"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <p className="mt-2 text-xs text-muted-foreground">{t("detail.safeFiles")}</p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {loading ? t("loading") : t("selectHint")}
          </div>
        )}
      </div>
    </div>
  );
}
