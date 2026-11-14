import { RAGMIR_SETUP_PROMPT } from "../content/setup-prompt"
import { CommandCopyBox, TextCopyButton } from "./command-copy"
import { SectionHeader } from "./section-header"
import { TabIndicator } from "./tab-indicator"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"
import { Textarea } from "./ui/textarea"

interface PackageManager {
  id: string
  label: string
  add: string
  exec: string
}

interface LibrarySectionProps {
  translations: Record<string, string>
}

export function LibrarySection({ translations }: LibrarySectionProps): React.JSX.Element {
  const t = (key: string): string => translations[key] ?? key
  const searchQuery = t("quickstart_search_query")
  const packageManagers: PackageManager[] = [
    {
      id: "npm",
      label: "npm",
      add: "npm install -D @jcode.labs/ragmir",
      exec: "npx",
    },
    { id: "pnpm", label: "pnpm", add: "pnpm add -D @jcode.labs/ragmir", exec: "pnpm exec" },
    { id: "yarn", label: "yarn", add: "yarn add --dev @jcode.labs/ragmir", exec: "yarn exec" },
    { id: "bun", label: "Bun", add: "bun add -d @jcode.labs/ragmir", exec: "bunx" },
    {
      id: "mise",
      label: "mise",
      add: "mise exec node@22 -- npm install -D @jcode.labs/ragmir",
      exec: "mise exec node@22 -- npx",
    },
  ]
  const installSteps = [
    {
      key: "install",
      label: t("quickstart_install_label"),
      build: (manager: PackageManager) => manager.add,
    },
    {
      key: "setup",
      label: t("quickstart_setup_label"),
      build: (manager: PackageManager) => `${manager.exec} rgr setup --no-ingest --agents codex`,
    },
    {
      key: "sources",
      label: t("quickstart_sources_label"),
      build: (manager: PackageManager) =>
        `${manager.exec} rgr sources add "docs/**/*.md" "src/**/*.ts"`,
    },
    {
      key: "ingest",
      label: t("quickstart_ingest_label"),
      build: (manager: PackageManager) => `${manager.exec} rgr ingest`,
    },
    {
      key: "search",
      label: t("quickstart_search_label"),
      build: (manager: PackageManager) => `${manager.exec} rgr search "${searchQuery}"`,
    },
  ]

  return (
    <section
      className="container-default relative z-10 px-5 py-16 md:px-8 md:py-40"
      id="library"
      aria-labelledby="library-heading"
    >
      <div className="mb-10 md:mb-14">
        <SectionHeader
          id="library-heading"
          label={t("library_eyebrow")}
          num="002"
          text={t("library_text")}
          title={t("library_title")}
        />
      </div>

      <Card className="mx-auto min-w-0 max-w-3xl overflow-hidden">
        <CardHeader className="gap-2 p-5 pb-0 md:p-6 md:pb-0">
          <CardTitle className="font-black text-xl">{t("quickstart_title")}</CardTitle>
          <CardDescription className="leading-6">{t("quickstart_text")}</CardDescription>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4 p-5 md:p-6">
          <Tabs className="min-w-0 gap-4" defaultValue="prompt">
            <div className="-mx-1 min-w-0 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsList className="relative flex w-max min-w-full rounded-full bg-background p-1">
                <TabIndicator activeSelector='[data-state="active"]' />
                <TabsTrigger
                  className="min-w-20 flex-1 justify-center rounded-full px-3 py-1.5 text-center font-semibold text-xs"
                  value="prompt"
                >
                  {t("quickstart_prompt_tab")}
                </TabsTrigger>
                {packageManagers.map((manager) => (
                  <TabsTrigger
                    className="min-w-16 flex-1 justify-center rounded-full px-2 py-1.5 text-center font-semibold text-xs"
                    key={manager.id}
                    value={manager.id}
                  >
                    {manager.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <TabsContent className="mt-0 grid min-w-0 gap-4" value="prompt">
              <div>
                <p className="font-bold text-xs">{t("quickstart_prompt_title")}</p>
                <p className="mt-1 text-[0.7rem] text-muted-foreground leading-4">
                  {t("quickstart_prompt_text")}
                </p>
              </div>
              <Textarea
                aria-label={t("quickstart_prompt_label")}
                className="h-[5.5rem] min-h-[5.5rem] min-w-0 resize-none overflow-y-auto whitespace-pre-wrap rounded-xl border-0 bg-background px-3.5 py-3 font-mono text-[0.68rem] text-foreground/80 leading-5"
                id="ragmir-setup-prompt"
                readOnly
                spellCheck={false}
                value={RAGMIR_SETUP_PROMPT}
              />
              <TextCopyButton
                className="w-full sm:w-fit"
                copiedLabel={t("command_copied")}
                copyLabel={t("copy_prompt")}
                text={RAGMIR_SETUP_PROMPT}
              />
            </TabsContent>
            {packageManagers.map((manager) => (
              <TabsContent className="mt-0 grid min-w-0 gap-3" key={manager.id} value={manager.id}>
                {installSteps.map((step) => (
                  <CommandCopyBox
                    command={step.build(manager)}
                    copyLabel={t("copy_command")}
                    key={step.key}
                  />
                ))}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </section>
  )
}
