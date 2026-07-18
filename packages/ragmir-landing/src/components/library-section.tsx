import { Code2 } from "lucide-react"
import { RAGMIR_SETUP_PROMPT } from "../content/setup-prompt"
import { CommandCopyBox, TextCopyButton } from "./command-copy"
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
      build: (manager: PackageManager) => `${manager.exec} rgr setup`,
    },
    {
      key: "agent",
      label: t("quickstart_agent_label"),
      build: (manager: PackageManager) =>
        `${manager.exec} rgr install-agent --agents claude,codex,kimi`,
    },
    {
      key: "search",
      label: t("quickstart_search_label"),
      build: (manager: PackageManager) => `${manager.exec} rgr search "${searchQuery}"`,
    },
  ]

  return (
    <section
      className="container-default relative z-10 grid gap-8 px-5 py-24 md:px-8 md:py-40 lg:grid-cols-[0.82fr_1.18fr] lg:items-center"
      id="library"
      aria-labelledby="library-heading"
    >
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {t("library_eyebrow")}
        </p>
        <h2 id="library-heading" className="mt-4 font-black text-2xl leading-tight md:text-3xl">
          {t("library_title")}
        </h2>
        <p className="mt-4 text-muted-foreground text-sm leading-6">{t("library_text")}</p>
      </div>

      <Card className="min-w-0 overflow-hidden bg-card/88 shadow-2xl shadow-black/35 backdrop-blur-xl">
        <CardHeader className="gap-3 border-b border-border p-5 md:p-6">
          <div className="flex items-center gap-3">
            <Code2 aria-hidden="true" className="size-5 text-muted-foreground" />
            <CardTitle className="font-black text-xl">{t("quickstart_title")}</CardTitle>
          </div>
          <CardDescription className="leading-6">{t("quickstart_text")}</CardDescription>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4 p-5 md:p-6">
          <Tabs className="min-w-0 gap-4" defaultValue="prompt">
            <div className="-mx-1 min-w-0 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsList className="flex w-max min-w-full rounded-md border border-border bg-card/82 p-1">
                <TabsTrigger
                  className="min-w-20 flex-1 justify-center rounded-sm px-3 py-2 text-center text-[0.625rem] uppercase tracking-[0.08em]"
                  value="prompt"
                >
                  {t("quickstart_prompt_tab")}
                </TabsTrigger>
                {packageManagers.map((manager) => (
                  <TabsTrigger
                    className="min-w-16 flex-1 justify-center rounded-sm px-2 py-2 text-center text-[0.625rem] uppercase tracking-[0.08em]"
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
                className="h-[4.125rem] min-h-[4.125rem] min-w-0 resize-none overflow-y-auto whitespace-pre-wrap border-foreground/35 bg-background/72 font-mono text-[0.625rem] text-foreground/78 leading-4 outline-1 outline-border/70 outline-solid"
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
