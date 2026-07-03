import type { ComponentProps } from "react"
import { cn } from "../lib/utils.js"

export function Input({ className, ...props }: ComponentProps<"input">): React.JSX.Element {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}
