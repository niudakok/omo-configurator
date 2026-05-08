import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type TabValue = "agents" | "mcp" | "providers" | "skills";

interface TabBarProps {
  value: TabValue;
  onValueChange: (value: TabValue) => void;
}

export function TabBar({ value, onValueChange }: TabBarProps) {
  const { t } = useTranslation("common");

  return (
    <Tabs
      value={value}
      onValueChange={(v) => onValueChange(v as TabValue)}
      className="w-full"
    >
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="agents">{t("tabs.agents")}</TabsTrigger>
        <TabsTrigger value="mcp">{t("tabs.mcp")}</TabsTrigger>
        <TabsTrigger value="providers">{t("tabs.providers")}</TabsTrigger>
        <TabsTrigger value="skills">{t("tabs.skills")}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
