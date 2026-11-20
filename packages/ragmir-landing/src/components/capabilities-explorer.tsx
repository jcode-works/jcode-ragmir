import type { ReactNode } from "react"
import { TabIndicator } from "./tab-indicator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"

export interface CapabilityGroup {
  key: string
  title: string
  items: { name: string; text: string }[]
}

interface CapabilitiesExplorerProps {
  groups: CapabilityGroup[]
  /** Accessible name of the group list. */
  label: string
  /** Stays under every group, aligned with the bottom of the rail: the supported formats. */
  children?: ReactNode
}

/**
 * Every feature, one group at a time: a rail of groups and the features of the selected one.
 * Every panel is rendered on the server, so search engines and agents read all of them; the page
 * shows only the selected one. On large screens the rail sets the height, so switching groups
 * never moves the rest of the page.
 */
export function CapabilitiesExplorer({
  groups,
  label,
  children,
}: CapabilitiesExplorerProps): React.JSX.Element {
  return (
    <Tabs
      className="gap-3 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-8"
      defaultValue={groups[0]?.key}
    >
      {/* A scrolling pill row on phones, a rail beside the features from large screens up. */}
      <TabsList
        aria-label={label}
        className="relative flex w-full justify-start gap-1 overflow-x-auto rounded-full bg-background p-1 [scrollbar-width:none] group-data-[orientation=horizontal]/tabs:h-auto lg:flex-col lg:items-stretch lg:self-start lg:overflow-visible lg:rounded-3xl [&::-webkit-scrollbar]:hidden"
      >
        <TabIndicator activeSelector='[data-state="active"]' />
        {groups.map((group) => (
          <TabsTrigger
            className="flex-none justify-start rounded-full px-4 py-2 font-semibold text-sm lg:w-full lg:py-2.5"
            key={group.key}
            value={group.key}
          >
            {group.title}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="flex min-w-0 flex-col px-2 pt-4 pb-2 md:px-3 lg:py-3 lg:pr-5 lg:pl-0">
        {groups.map((group) => (
          <TabsContent
            className="panel-in mt-0 data-[state=inactive]:hidden"
            forceMount
            key={group.key}
            value={group.key}
          >
            <ul className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
              {group.items.map((item) => (
                <li key={item.name}>
                  <p className="font-bold">{item.name}</p>
                  <p className="mt-1 text-muted-foreground text-sm leading-6">{item.text}</p>
                </li>
              ))}
            </ul>
          </TabsContent>
        ))}
        <div className="mt-auto pt-8">{children}</div>
      </div>
    </Tabs>
  )
}
