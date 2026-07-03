import type { ComponentProps } from "react"
import { cn } from "../lib/utils.js"

export function Card({ className, ...props }: ComponentProps<"div">): React.JSX.Element {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground shadow-sm",
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: ComponentProps<"div">): React.JSX.Element {
  return <div className={cn("flex flex-col gap-1.5 p-5", className)} {...props} />
}

export function CardTitle({ className, ...props }: ComponentProps<"h3">): React.JSX.Element {
  return <h3 className={cn("text-lg font-semibold leading-none", className)} {...props} />
}

export function CardDescription({ className, ...props }: ComponentProps<"p">): React.JSX.Element {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />
}

export function CardContent({ className, ...props }: ComponentProps<"div">): React.JSX.Element {
  return <div className={cn("p-5 pt-0", className)} {...props} />
}
