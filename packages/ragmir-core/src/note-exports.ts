import type { HtmlRenderer } from "./mail.js"
import type { StructuredSection } from "./structured-formats.js"
import {
  childElements,
  childText,
  descendants,
  documentElement,
  firstChild,
  localName,
  parseXmlTree,
  textContent,
  type XmlElement,
} from "./xml-tree.js"

/** Evernote export (`.enex`): one section per note with its tags, dates, source, and body. */
export function evernoteSections(xml: string, renderHtml: HtmlRenderer): StructuredSection[] {
  const root = documentElement(parseXmlTree(xml))
  if (!root || localName(root.name) !== "en-export") {
    throw new Error("Evernote export has no en-export root element.")
  }
  return childElements(root, "note").map((note, index) => {
    const title = childText(note, "title") || `Note ${index + 1}`
    const attributes = firstChild(note, "note-attributes")
    const tags = childElements(note, "tag")
      .map((tag) => textContent(tag))
      .filter(Boolean)
    const attachments = childElements(note, "resource")
      .map((resource) => {
        const resourceAttributes = firstChild(resource, "resource-attributes")
        return resourceAttributes ? childText(resourceAttributes, "file-name") : ""
      })
      .filter(Boolean)
    const content = rawText(firstChild(note, "content"))
    return {
      label: `Note ${title}`,
      text: [
        `Note: ${title}`,
        tags.length > 0 ? `Tags: ${tags.join(", ")}` : "",
        evernoteDate("Created", childText(note, "created")),
        evernoteDate("Updated", childText(note, "updated")),
        attributes && childText(attributes, "author")
          ? `Author: ${childText(attributes, "author")}`
          : "",
        attributes && childText(attributes, "source-url")
          ? `Source: ${childText(attributes, "source-url")}`
          : "",
        attachments.length > 0 ? `Attachments: ${attachments.join(", ")}` : "",
        "",
        content ? renderHtml(content).trim() : "",
      ]
        .filter((line, position, all) => line !== "" || (position > 0 && all[position - 1] !== ""))
        .join("\n")
        .trim(),
    }
  })
}

/** FictionBook (`.fb2`): the book description, then one section per top-level chapter. */
export function fictionBookSections(xml: string): StructuredSection[] {
  const root = documentElement(parseXmlTree(xml))
  if (!root || localName(root.name) !== "FictionBook") {
    throw new Error("FictionBook file has no FictionBook root element.")
  }
  const sections: StructuredSection[] = []
  const titleInfo = firstChild(firstChild(root, "description") ?? root, "title-info")
  const bookTitle = titleInfo ? childText(titleInfo, "book-title") : ""
  if (titleInfo) {
    const authors = childElements(titleInfo, "author")
      .map((author) =>
        ["first-name", "middle-name", "last-name", "nickname"]
          .map((part) => childText(author, part))
          .filter(Boolean)
          .join(" "),
      )
      .filter(Boolean)
    sections.push({
      label: `Book ${bookTitle || "description"}`,
      text: [
        `Book: ${bookTitle}`,
        authors.length > 0 ? `Authors: ${authors.join(", ")}` : "",
        paragraphs(firstChild(titleInfo, "annotation")),
      ]
        .filter(Boolean)
        .join("\n"),
    })
  }
  for (const body of childElements(root, "body")) {
    const notes = body.attributes.name === "notes" || body.attributes.name === "comments"
    const chapters = childElements(body, "section")
    if (notes || chapters.length === 0) {
      const text = paragraphs(body)
      if (text) {
        sections.push({ label: notes ? "Notes" : `Text ${bookTitle}`, text })
      }
      continue
    }
    for (const [index, chapter] of chapters.entries()) {
      const title =
        paragraphs(firstChild(chapter, "title")).replace(/\n/gu, " ") || `Chapter ${index + 1}`
      const text = paragraphs(chapter)
      if (text) {
        sections.push({ label: `Chapter ${title}`, text })
      }
    }
  }
  return sections
}

/** One line per paragraph, verse, or subtitle, in document order. */
function paragraphs(element: XmlElement | undefined): string {
  if (!element) {
    return ""
  }
  return descendants(element)
    .filter((child) => ["p", "v", "subtitle", "text-author"].includes(localName(child.name)))
    .map((child) => textContent(child))
    .filter(Boolean)
    .join("\n")
}

/** Raw text children, without collapsing the markup an ENML note body holds. */
function rawText(element: XmlElement | undefined): string {
  return element
    ? element.children
        .filter((child): child is string => typeof child === "string")
        .join("")
        .trim()
    : ""
}

function evernoteDate(label: string, value: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u.exec(value)
  if (!match) {
    return value ? `${label}: ${value}` : ""
  }
  return `${label}: ${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]} UTC`
}
