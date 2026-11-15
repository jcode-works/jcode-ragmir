import { Parser } from "htmlparser2"

/** Minimal element tree for structured XML exports: names keep their namespace prefix. */
export interface XmlElement {
  name: string
  attributes: Record<string, string>
  children: XmlNode[]
}

export type XmlNode = XmlElement | string

export function parseXmlTree(xml: string): XmlElement {
  const root: XmlElement = { name: "#document", attributes: {}, children: [] }
  const stack: XmlElement[] = [root]
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        const element: XmlElement = { name, attributes: { ...attributes }, children: [] }
        stack.at(-1)?.children.push(element)
        stack.push(element)
      },
      ontext(text) {
        stack.at(-1)?.children.push(text)
      },
      onclosetag() {
        if (stack.length > 1) {
          stack.pop()
        }
      },
    },
    { xmlMode: true, decodeEntities: true },
  )
  parser.write(xml)
  parser.end()
  return root
}

/** Element name without its namespace prefix. */
export function localName(name: string): string {
  const separator = name.indexOf(":")
  return separator < 0 ? name : name.slice(separator + 1)
}

export function childElements(element: XmlElement, name?: string): XmlElement[] {
  const elements: XmlElement[] = []
  for (const child of element.children) {
    if (typeof child !== "string" && (name === undefined || matchesName(child, name))) {
      elements.push(child)
    }
  }
  return elements
}

export function firstChild(element: XmlElement, name: string): XmlElement | undefined {
  for (const child of element.children) {
    if (typeof child !== "string" && matchesName(child, name)) {
      return child
    }
  }
  return undefined
}

/** Depth-first descendants in document order, optionally filtered by name. */
export function descendants(element: XmlElement, name?: string): XmlElement[] {
  const found: XmlElement[] = []
  const pending = [...childElements(element)].reverse()
  while (pending.length > 0) {
    const current = pending.pop() as XmlElement
    if (name === undefined || matchesName(current, name)) {
      found.push(current)
    }
    pending.push(...childElements(current).reverse())
  }
  return found
}

/** Text content of an element and its descendants, whitespace collapsed. */
export function textContent(element: XmlElement | undefined): string {
  if (!element) {
    return ""
  }
  const parts: string[] = []
  const pending: XmlNode[] = [...element.children].reverse()
  while (pending.length > 0) {
    const current = pending.pop() as XmlNode
    if (typeof current === "string") {
      parts.push(current)
    } else {
      pending.push(...[...current.children].reverse())
    }
  }
  return collapseWhitespace(parts.join(" "))
}

/** Text of the direct child with this name, or an empty string. */
export function childText(element: XmlElement, name: string): string {
  return textContent(firstChild(element, name))
}

/** Attribute value matched by local name, so `xsi:type` and `type` both answer `type`. */
export function attribute(element: XmlElement, name: string): string {
  const direct = element.attributes[name]
  if (direct !== undefined) {
    return direct.trim()
  }
  for (const [key, value] of Object.entries(element.attributes)) {
    if (localName(key) === name) {
      return value.trim()
    }
  }
  return ""
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim()
}

/** Keeps line breaks of multi-line comments while trimming each line. */
export function multilineText(value: string): string {
  return value
    .split(/\r?\n/u)
    .map((line) => line.replace(/[ \t]+/gu, " ").trim())
    .filter(Boolean)
    .join("\n")
}

/** Root element of a document, skipping text nodes. */
export function documentElement(document: XmlElement): XmlElement | undefined {
  return childElements(document)[0]
}

function matchesName(element: XmlElement, name: string): boolean {
  return name.includes(":") ? element.name === name : localName(element.name) === name
}
