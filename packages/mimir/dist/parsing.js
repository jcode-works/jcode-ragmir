import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { htmlToText } from "html-to-text";
import { extractText, getDocumentProxy } from "unpdf";
import YAML from "yaml";
const MAX_OFFICE_XML_ENTRY_BYTES = 25_000_000;
export async function parseFile(file) {
    let text;
    switch (file.extension) {
        case ".pdf":
            text = await parsePdf(file.absolutePath);
            break;
        case ".docx":
            text = await parseDocx(file.absolutePath);
            break;
        case ".pptx":
            text = await parsePptx(file.absolutePath);
            break;
        case ".xlsx":
            text = await parseXlsx(file.absolutePath);
            break;
        case ".odt":
        case ".ods":
        case ".odp":
            text = await parseOpenDocument(file.absolutePath);
            break;
        case ".html":
        case ".htm":
            text = htmlToText(await readFile(file.absolutePath, "utf8"), {
                wordwrap: false,
                selectors: [
                    { selector: "a", options: { ignoreHref: true } },
                    { selector: "img", format: "skip" },
                ],
            });
            break;
        case ".json":
            text = JSON.stringify(JSON.parse(await readFile(file.absolutePath, "utf8")), null, 2);
            break;
        case ".yaml":
        case ".yml":
            text = YAML.stringify(YAML.parse(await readFile(file.absolutePath, "utf8")));
            break;
        case ".rtf":
            text = stripRtf(await readFile(file.absolutePath, "utf8"));
            break;
        default:
            text = await readFile(file.absolutePath, "utf8");
    }
    return { file, text: normalizeText(text) };
}
async function parseDocx(filePath) {
    const entries = unzipOfficeFile(await readFile(filePath));
    return xmlEntriesToText(entries, [
        /^word\/document\.xml$/u,
        /^word\/header\d*\.xml$/u,
        /^word\/footer\d*\.xml$/u,
        /^word\/footnotes\.xml$/u,
        /^word\/endnotes\.xml$/u,
        /^word\/comments\.xml$/u,
    ]);
}
async function parsePptx(filePath) {
    const entries = unzipOfficeFile(await readFile(filePath));
    return xmlEntriesToText(entries, [
        /^ppt\/slides\/slide\d+\.xml$/u,
        /^ppt\/notesSlides\/notesSlide\d+\.xml$/u,
    ]);
}
async function parseXlsx(filePath) {
    const entries = unzipOfficeFile(await readFile(filePath));
    const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml") ?? "");
    const sheets = [...entries.entries()]
        .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name))
        .sort(([a], [b]) => a.localeCompare(b));
    const rows = [];
    for (const [name, xml] of sheets) {
        const values = parseSheetValues(xml, sharedStrings);
        if (values.length > 0) {
            rows.push(`# ${name}`, values.join("\n"));
        }
    }
    return rows.join("\n\n");
}
async function parseOpenDocument(filePath) {
    const entries = unzipOfficeFile(await readFile(filePath));
    return xmlEntriesToText(entries, [/^content\.xml$/u, /^meta\.xml$/u]);
}
function unzipOfficeFile(buffer) {
    const unzipped = unzipSync(new Uint8Array(buffer), {
        filter: (file) => file.originalSize <= MAX_OFFICE_XML_ENTRY_BYTES,
    });
    const entries = new Map();
    for (const [name, content] of Object.entries(unzipped)) {
        if (name.endsWith(".xml")) {
            entries.set(name, strFromU8(content));
        }
    }
    return entries;
}
function xmlEntriesToText(entries, patterns) {
    const parts = [];
    for (const [name, xml] of [...entries.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        if (patterns.some((pattern) => pattern.test(name))) {
            const text = xmlToText(xml);
            if (text) {
                parts.push(text);
            }
        }
    }
    return parts.join("\n\n");
}
function parseSharedStrings(xml) {
    return [...xml.matchAll(/<si\b[\s\S]*?<\/si>/gu)].map(([item]) => xmlToText(item));
}
function parseSheetValues(xml, sharedStrings) {
    const rows = [];
    for (const rowMatch of xml.matchAll(/<row\b[\s\S]*?<\/row>/gu)) {
        const rowXml = rowMatch[0];
        const values = [...rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gu)]
            .map((cellMatch) => {
            const attrs = cellMatch[1] ?? "";
            const cellXml = cellMatch[2] ?? "";
            const inline = firstMatch(cellXml, /<is\b[\s\S]*?<\/is>/u);
            if (inline) {
                return xmlToText(inline);
            }
            const rawValue = firstMatch(cellXml, /<v>([\s\S]*?)<\/v>/u);
            if (!rawValue) {
                return "";
            }
            if (/\bt="s"/u.test(attrs)) {
                return sharedStrings[Number.parseInt(rawValue, 10)] ?? "";
            }
            return decodeXmlEntities(rawValue);
        })
            .filter(Boolean);
        if (values.length > 0) {
            rows.push(values.join("\t"));
        }
    }
    return rows;
}
function firstMatch(input, pattern) {
    const match = input.match(pattern);
    return match?.[1] ?? match?.[0] ?? "";
}
function xmlToText(xml) {
    return normalizeText(decodeXmlEntities(xml
        .replace(/<w:tab\/>/gu, " ")
        .replace(/<w:br\/>/gu, "\n")
        .replace(/<\/(?:w:p|a:p|text:p|text:h|table:table-row)>/gu, "\n")
        .replace(/<[^>]+>/gu, " ")
        .replace(/[ \t]{2,}/gu, " ")));
}
function stripRtf(input) {
    return input
        .replace(/\\par[d]?/gu, "\n")
        .replace(/\\'[0-9a-fA-F]{2}/gu, " ")
        .replace(/\\[a-zA-Z]+-?\d* ?/gu, " ")
        .replace(/[{}]/gu, " ");
}
function decodeXmlEntities(input) {
    return input
        .replace(/&lt;/gu, "<")
        .replace(/&gt;/gu, ">")
        .replace(/&quot;/gu, '"')
        .replace(/&apos;/gu, "'")
        .replace(/&amp;/gu, "&");
}
async function parsePdf(filePath) {
    const buffer = await readFile(filePath);
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    return result.text;
}
function normalizeText(input) {
    return input
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{4,}/g, "\n\n\n")
        .trim();
}
//# sourceMappingURL=parsing.js.map