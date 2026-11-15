---
name: add-file-format
description: Add or extend a file format that Ragmir indexes, from extension registration and parsing to citations, tests, the parser policy version, and every public format list. Use when a contributor asks Ragmir to index a new extension, file name, tool export, or document type, or to cite an existing format at a finer level.
metadata:
  internal: "true"
---

# Add a file format to Ragmir

Ragmir indexes a format only when it can cite what it extracts. Decide first which citation the
format deserves, then wire it through discovery, parsing, tests, the parser policy, and the docs.

## 1. Choose the extraction

| Format kind | Approach | Citation |
| --- | --- | --- |
| Plain text, code, configuration | Register the extension; text keeps its lines | `:L12-L18` |
| Markup with a reader (HTML, OpenDocument XML) | Render readable text in `src/parsing.ts` | none or native coordinates |
| Paged or sliced documents | Return `pages` or `regions` from the parser | `:p3`, `:slide2`, `:sheet=...:cells=A1-C4` |
| One file holding many objects (exports, diagrams, mailboxes, models) | Return sections through `sectionRegions()` | `:section=<label>` |
| JSON-based tool exports | Add a detector to `jsonExportSections()` in `src/data-exports.ts` | `:section=<label>` |

Rules that every parser follows:

- Never execute or evaluate document content, and never start a process unless an operator
  configured a local extractor. Archives use `unzipOfficeFile()` with an entry pattern; bound
  decompressed size, entry count, and nesting the way `src/figma-file.ts` and `src/mail.ts` do.
- Pass `options.signal` through long loops and archive reads.
- Emit only verifiable coordinates. A transformed format gets sections or native coordinates,
  never invented line numbers.
- Leave secrets out of the text: API collections replace header and auth values with
  `(value omitted)`.

## 2. Wire it

1. Register the extension in `src/files.ts`: `DEFAULT_SUPPORTED_EXTENSIONS` (keep its groups), or
   `DEFAULT_SUPPORTED_FILE_NAMES` and `DEFAULT_SUPPORTED_NAME_PREFIXES` for extensionless files.
   A format Ragmir should refuse with export advice goes in `EXPORT_RECOMMENDATIONS` instead.
2. Add the case to `parseFile()` in `src/parsing.ts`, or a new module beside `src/mail.ts`,
   `src/design-formats.ts`, `src/note-exports.ts`, or `src/data-exports.ts`.
3. Markdown-like formats join `MARKDOWN_EXTENSIONS` in `src/document-structure.ts` to keep heading
   paths; check `src/chunking.ts` and `src/source-weights.ts` when the format needs special
   chunking or ranking.
4. Bump `parserVersion` in `src/index-policy.ts` when existing files would now be extracted
   differently. Indexes built before the bump then stage a validated rebuild on the next ingest.

## 3. Test it

- Add cases to `src/formats.test.ts`, building fixtures in the test from synthetic data. Never
  commit a real export from a user or vendor sample of unclear license.
- Assert the extracted text, each section label or coordinate, and the limits: a truncated or
  oversized file must fail cleanly or report a readable error.
- Run `pnpm --filter @jcode.labs/ragmir test src/formats.test.ts src/supported-formats-doc.test.ts`.

## 4. Document it

- `docs/supported-formats.md`: the extension in its table; `src/supported-formats-doc.test.ts`
  fails when the doc and `src/files.ts` disagree.
- The landing list in `packages/ragmir-landing/src/content/supported-formats.ts`, and the
  `faq_formats_answer` count in both message files when the total changes.
- `llms.txt` and the README when the format is worth naming publicly.

Finish with `pnpm validate`. Report the formats added, the citation each one produces, and the
parser version change.
