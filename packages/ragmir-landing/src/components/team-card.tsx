import { cn } from "../lib/utils"

interface TeamCardLink {
  label: string
  href: string
}

interface TeamCardProps {
  title: string
  subtitle: string
  description: string
  img: string
  links: TeamCardLink[]
  className?: string
}

export function TeamCard({
  title,
  subtitle,
  description,
  img,
  links,
  className,
}: TeamCardProps): React.JSX.Element {
  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      <div className="size-28 overflow-hidden rounded-full border border-border">
        <img
          alt={title}
          className="size-full object-cover"
          decoding="async"
          height="112"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={img}
          width="112"
        />
      </div>
      <h3 className="mt-5 font-black text-xl">{title}</h3>
      <p className="mt-1 font-semibold text-muted-foreground text-sm">{subtitle}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {links.map((link) => (
          <a
            className="rounded-full border border-border px-3 py-1 font-semibold text-muted-foreground text-xs transition hover:border-[var(--accent-title)] hover:text-foreground"
            href={link.href}
            key={link.href}
            rel="nofollow noreferrer noopener"
            target="_blank"
          >
            {link.label}
          </a>
        ))}
      </div>
      <p className="mt-5 max-w-sm text-muted-foreground text-sm leading-7">{description}</p>
    </div>
  )
}
