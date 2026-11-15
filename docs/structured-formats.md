# Structured formats

Ragmir reads data models, diagrams, process models, BI workbooks, and API descriptions object by
object. Each table, entity, diagram page, decision, or operation becomes its own cited section, so
an agent can quote `models/billing.pdm:section=Table%20BIL_INVOICE#3` instead of a line range of a
large XML export. Diagram geometry, styles, and layout symbols are left out of the index.

Everything runs locally: these extractors only read files, and no model or service is involved.

## Supported exports

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

Plain-text formats keep line citations: PL/SQL (`.pkb`, `.pks`, `.pls`, `.plb`, `.pck`, `.bdy`,
`.trg`, `.fnc`, `.prc`), Kotlin, Swift, Dart, Scala, Groovy and Gradle, Lua, R, Perl, Elixir, Erlang,
Haskell, Clojure, F#, Visual Basic, Solidity, COBOL, Terraform and HCL, Protobuf, GraphQL, Avro,
Thrift, `.http`, XSD, WSDL, PlantUML, Structurizr DSL, D2, DBML, Prisma, JasperReports, and
`*.dockerfile`.

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
