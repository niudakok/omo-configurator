import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import zhCommon from "./locales/zh-CN/common.json";
import zhAgents from "./locales/zh-CN/agents.json";
import zhMcp from "./locales/zh-CN/mcp.json";
import zhProviders from "./locales/zh-CN/providers.json";
import zhSnapshot from "./locales/zh-CN/snapshot.json";
import zhSkills from "./locales/zh-CN/skills.json";

import enCommon from "./locales/en-US/common.json";
import enAgents from "./locales/en-US/agents.json";
import enMcp from "./locales/en-US/mcp.json";
import enProviders from "./locales/en-US/providers.json";
import enSnapshot from "./locales/en-US/snapshot.json";
import enSkills from "./locales/en-US/skills.json";

const resources = {
  "zh-CN": {
    common: zhCommon,
    agents: zhAgents,
    mcp: zhMcp,
    providers: zhProviders,
    snapshot: zhSnapshot,
    skills: zhSkills,
  },
  "en-US": {
    common: enCommon,
    agents: enAgents,
    mcp: enMcp,
    providers: enProviders,
    snapshot: enSnapshot,
    skills: enSkills,
  },
};

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "zh-CN",
    defaultNS: "common",
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
