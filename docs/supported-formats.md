# Supported formats

Ragmir indexes every format below with no extra install, unless the table says otherwise. Each
result carries a citation an agent can quote and open again: lines for text, pages for PDF, slides,
sheets and cells, EPUB spine items, a passage number for reformatted text, or a named section for one object of a data model, diagram, or
API description. `rgr audit --unsupported` lists the files of your sources that Ragmir skipped.

## Every format

| Family | Extensions and file names | Citation |
| --- | --- | --- |
| Documents | `.pdf`, `.docx`, `.pptx`, `.xlsx`, `.odt`, `.odp`, `.ods`, `.epub`, `.rtf`, `.html`, `.htm` | Page, slide, sheet and cells, EPUB item, or passage |
| Writing and markup | `.md`, `.markdown`, `.mdown`, `.mdx`, `.txt`, `.text`, `.adoc`, `.rst`, `.tex` | Lines |
| Mail, calendar, captions, feeds | `.eml`, `.msg`, `.ics`, `.srt`, `.vtt`, `.rss`, `.atom` | Lines (`.msg`: passage) |
| Data and configuration | `.csv`, `.tsv`, `.json`, `.jsonl`, `.ndjson`, `.ipynb`, `.yaml`, `.yml`, `.toml`, `.ini`, `.cfg`, `.conf`, `.properties`, `.xml`, `.log`, `.example`, `.exemple` | Lines (JSON and YAML: passage) |
| Data models and SQL | PowerDesigner `.cdm`, `.ldm`, `.pdm`, `.oom`, `.bpm`, `.mcd`, `.mpd`; MySQL Workbench `.mwb`; Oracle Data Modeler `.dmd`; ERwin XML; `.sql`; PL/SQL `.pkb`, `.pks`, `.pls`, `.plb`, `.pck`, `.bdy`, `.trg`, `.fnc`, `.prc`; `.dbml`, `.prisma` | Section per object, or lines |
| Diagrams and processes | draw.io `.drawio`; Visio `.vsdx`; `.bpmn`, `.dmn`; ArchiMate `.archimate`; UML `.xmi`; Mermaid `.mmd`; PlantUML `.puml`, `.plantuml`; Structurizr `.dsl`; D2 `.d2`; `.svg` | Section per page or object, or lines |
| APIs and schemas | OpenAPI, Swagger, and AsyncAPI in YAML or JSON; `.graphql`, `.gql`, `.proto`, `.avsc`, `.thrift`, `.xsd`, `.wsdl`, `.http` | Section per operation, or lines |
| BI and reporting | Tableau `.twb`, `.twbx`; Power BI project `.tmdl`, `.pbip`, `.pbir`, `.pbism`, `.bim`; JasperReports `.jrxml` | Section per object, or lines |
| Code | `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.vue`, `.svelte`, `.astro`, `.css`, `.scss`, `.py`, `.java`, `.kt`, `.kts`, `.scala`, `.groovy`, `.gradle`, `.go`, `.rs`, `.c`, `.h`, `.cpp`, `.hpp`, `.cs`, `.vb`, `.fs`, `.php`, `.rb`, `.swift`, `.dart`, `.lua`, `.r`, `.pl`, `.ex`, `.exs`, `.erl`, `.hs`, `.clj`, `.sol`, `.cbl`, `.cob` | Lines |
| Infrastructure and scripts | `.tf`, `.hcl`, `.tpl` and Helm YAML templates, `.dockerfile`, `Dockerfile`, `Makefile`, `Procfile`, `Gemfile`, `Rakefile`, `gradlew`, `mvnw`, `.sh`, `.bash`, `.ps1`, `.bat`, `.cmd`, `.diff`, `.patch`, `.gitignore`, `.dockerignore`, `.npmignore` | Lines |
| With a local extractor (optional) | Scanned PDF pages; images `.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.webp`, `.gif`, `.bmp`, `.heic`, `.heif`, `.avif`; legacy Word `.doc` | Page or passage |

Office charts are indexed with their titles, axes, series, and values. Other text extensions can be
added with `includeExtensions` in the [configuration](./configuration.md). Binary formats outside
this list are reported, never guessed.

## Structured exports in detail

| Tool or standard | Files | What each section holds |
| --- | --- | --- |
| PowerDesigner | `.cdm`, `.ldm`, `.pdm`, `.oom`, `.bpm`, `.mcd`, `.mpd`, or `.xml` saved as XML | Entities, tables, views, associations, references, inheritances, domains, business rules, classes, and packages, with columns or attributes, types, comments, keys, indexes, joins, and the objects that reference them |
| ERwin Data Modeler | XML export (`.xml`) | Entities, attributes with physical names and types, relationships |
| MySQL Workbench | `.mwb` | Tables, columns, foreign keys, indexes, views, routines |
| Oracle SQL Developer Data Modeler | object `.xml` files in the design folder | Entities, tables, and their attributes or columns with comments |
| draw.io / diagrams.net | `.drawio`, `.drawio.svg`, or `.xml` | One section per page: shape labels, custom properties, containers, and connections |
| Visio | `.vsdx` | One section per page: shape text and connectors |
| BPMN 2.0 | `.bpmn` or `.xml` | Processes with lanes, steps, documentation, flows, and conditions; collaborations |
| DMN | `.dmn` or `.xml` | Decisions with hit policy, inputs, outputs, every rule, and requirements |
| ArchiMate | `.archimate` (Archi) or Open Group exchange `.xml` | Elements with documentation, properties, and relations |
| UML | `.xmi` or `.xml` | Classes, interfaces, enumerations, components, actors, use cases, attributes, operations, generalizations, notes |
| Tableau | `.twb`, `.twbx` | Data sources with fields and calculated formulas, worksheets, dashboards |
| OpenAPI, Swagger, AsyncAPI | `.yaml`, `.yml`, `.json` | API overview, each operation (`GET /invoices/{id}`), channel, message, and schema |
| Power BI project | `.tmdl`, `.pbip`, `.pbir`, `.pbism`, `.bim` | TMDL as text with line citations, PBIR and TMSL as JSON |
| Outlook | `.msg` | Subject, sender, recipients, date, attachment names, and body |

## How detection works

A file with a dedicated extension uses its extractor. A generic `.xml` file is read as structured
only when its first bytes identify the tool: the PowerDesigner processing instruction, or the root
element and namespace of draw.io, BPMN, DMN, ArchiMate, XMI, MySQL Workbench, Oracle Data
Modeler, ERwin, or Tableau. Any other XML file, such as a Maven `pom.xml`, keeps line citations.

## Exports that need one step first

- **PowerDesigner binary models.** Save the model in XML format. Ragmir reports a binary model as a
  file error and keeps indexing the rest of the corpus. PowerDesigner backups (`.bcd`, `.bpd`) are
  not indexed because they duplicate the model.
- **Oracle SQL Developer Data Modeler.** The `.dmd` file only points to the design folder. Add the
  folder next to it to your sources so the object files are indexed.
- **Power BI `.pbix`.** The model is stored in a compressed binary part. Save the report as a Power
  BI project (PBIP) with the TMDL format and index the project folder.
- **Enterprise Architect `.qea` and `.eap`.** These are databases. Export the model to XMI.
- **Figma `.fig`.** The format is private and binary. Export frames or specifications as text,
  Markdown, or PDF.

## Limits

One file produces at most 20,000 sections; a last section records how many objects were left out.
A compressed draw.io page expands to at most 25 MB. Archives (`.mwb`, `.vsdx`, `.twbx`) use the
same entry-count and size limits as Office files. A damaged file is reported in the ingestion
errors and does not stop ingestion.

After an upgrade, the next `rgr ingest` stages a rebuild with the new extractors and activates it
only once it passes validation. The previous index stays searchable meanwhile, and
`.ragmir/storage/` never needs to be deleted.
