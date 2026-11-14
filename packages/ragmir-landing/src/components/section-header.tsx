interface SectionHeaderProps {
  /** Chapter number in page order, such as "003". */
  num: string
  label: string
  title: string
  text?: string
  id: string
}

/**
 * Chapter header shared by every landing section: a numbered kicker, a display title, and one
 * line of context. It starts at the left on a phone and centres from `md`, like WorkoutGen's.
 */
export function SectionHeader({
  num,
  label,
  title,
  text,
  id,
}: SectionHeaderProps): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[860px] text-start md:text-center">
      <p className="flex items-baseline gap-2 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.25em] md:items-center md:justify-center md:gap-3">
        <span aria-hidden="true" className="hidden h-px w-10 bg-foreground/40 md:block" />
        <span className="tnum shrink-0">{num}</span>
        <span aria-hidden="true" className="shrink-0 opacity-60">
          ·
        </span>
        <span>{label}</span>
        <span aria-hidden="true" className="hidden h-px w-10 bg-foreground/40 md:block" />
      </p>
      <h2 className="display mt-6 text-balance text-3xl md:text-5xl" id={id}>
        {title}
      </h2>
      {text && (
        <p className="mt-6 text-base text-muted-foreground leading-relaxed md:mx-auto md:max-w-[560px]">
          {text}
        </p>
      )}
    </div>
  )
}

/** Card tag such as "02 / 04", the position of a card among its siblings. */
export function cardTag(position: number, total: number): string {
  return `${String(position).padStart(2, "0")} / ${String(total).padStart(2, "0")}`
}
