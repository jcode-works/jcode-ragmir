import type { ComponentProps } from "react"
import { cn } from "../lib/utils.js"

export interface ProgressProps extends ComponentProps<"div"> {
  value: number
}

export function Progress({ className, value, ...props }: ProgressProps): React.JSX.Element {
  const safeValue = Math.max(0, Math.min(100, value))
  return (
    <div
      className={cn("h-2 overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safeValue}
      {...props}
    >
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${safeValue}%` }}
      />
    </div>
  )
}
