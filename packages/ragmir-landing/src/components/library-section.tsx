import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  RagmirBackground,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@jcode.labs/ragmir-ui"
import { Code2 } from "lucide-react"
import { CommandCopyBox } from "./command-copy"

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
    { id: "pnpm", label: "pnpm", add: "pnpm add -D @jcode.labs/ragmir", exec: "pnpm exec" },
    { id: "npm", label: "npm", add: "npm install --save-dev @jcode.labs/ragmir", exec: "npm exec" },
    { id: "yarn", label: "yarn", add: "yarn add --dev @jcode.labs/ragmir", exec: "yarn exec" },
    {
      id: "mise",
      label: "mise",
      add: "mise exec node@24 -- npm install --save-dev @jcode.labs/ragmir",
      exec: "mise exec node@24 -- npm exec",
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
      className="container-wide relative z-10 grid gap-8 px-5 py-24 md:px-8 md:py-40 lg:grid-cols-[0.82fr_1.18fr] lg:items-center"
      id="library"
      aria-labelledby="library-heading"
    >
      <RagmirBackground behindContent className="inset-0" height="100%" />
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {t("library_eyebrow")}
        </p>
        <h2 id="library-heading" className="mt-4 font-black text-2xl leading-tight md:text-3xl">
          {t("library_title")}
        </h2>
        <p className="mt-4 text-muted-foreground text-sm leading-6">{t("library_text")}</p>
      </div>

      <Card className="overflow-hidden bg-card/88 shadow-2xl shadow-black/35 backdrop-blur-xl">
        <CardHeader className="gap-3 border-b border-border p-5 md:p-6">
          <div className="flex items-center gap-3">
            <Code2 aria-hidden="true" className="size-5 text-muted-foreground" />
            <CardTitle className="font-black text-xl">{t("quickstart_title")}</CardTitle>
          </div>
          <CardDescription className="leading-6">{t("quickstart_text")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 p-5 md:p-6">
          <Tabs className="gap-4" defaultValue={packageManagers[0]?.id ?? "pnpm"}>
            <TabsList className="flex w-full rounded-full border border-border bg-card/82 p-1">
              {packageManagers.map((manager) => (
                <TabsTrigger
                  className="flex-1 justify-center rounded-full px-2 py-2 text-center text-xs uppercase"
                  key={manager.id}
                  value={manager.id}
                >
                  {manager.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {packageManagers.map((manager) => (
              <TabsContent className="mt-0 grid gap-3" key={manager.id} value={manager.id}>
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
