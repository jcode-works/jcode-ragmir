# Supported formats

Ragmir indexes every format below with no extra install, unless the table says otherwise. Each
result carries a citation an agent can quote and open again: lines for text, pages for PDF, slides,
sheets and cells, EPUB spine items, a passage number for reformatted text, or a named section for
one object of a mailbox, design file, data model, diagram, API description, or collection.
`rgr audit --unsupported` lists the files of your sources that Ragmir skipped.

## Every format

| Family | Extensions and file names | Citation |
| --- | --- | --- |
| Documents | `.pdf`, `.docx`, `.docm`, `.dotx`, `.dotm`, `.pptx`, `.pptm`, `.potx`, `.potm`, `.ppsx`, `.ppsm`, `.xlsx`, `.xlsm`, `.xltx`, `.xltm`, `.odt`, `.ods`, `.odp`, `.odg`, `.ott`, `.ots`, `.otp`, `.otg`, `.fodt`, `.fods`, `.fodp`, `.fodg`, `.epub`, `.fb2`, `.rtf`, `.html`, `.htm`, `.xhtml`, `.xht`, `.shtml`, `.mhtml`, `.mht` | Page, slide, sheet and cells, EPUB item, chapter, or passage |
| Writing and markup | `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`, `.mdwn`, `.mdtext`, `.mdtxt`, `.mdx`, `.mdoc`, `.mdc`, `.livemd`, `.qmd`, `.rmd`, `.rnw`, `.txt`, `.text`, `.adoc`, `.asciidoc`, `.rst`, `.org`, `.typ`, `.tex`, `.ltx`, `.sty`, `.cls`, `.bib`, `.ris`, `.textile`, `.wiki`, `.mediawiki`, `.creole`, `.rdoc`, `.pod`, `.texi`, `.texinfo`, `.txi`, `.opml`, `.wikitext`, `.pod6`, `.scrbl`, `.rd`, `.bibtex`, `.bst`, `.dtx`, `.ins`, `.mkiv`, `.dita`, `.ditamap`, `.ditaval`, `.man`, `.roff`, `.ronn` | Lines |
| Mail, contacts, calendar, captions, and feeds | `.eml`, `.emlx`, `.mbox`, `.msg`, `.vcf`, `.ics`, `.ical`, `.vcs`, `.srt`, `.vtt`, `.ass`, `.ssa`, `.sbv`, `.lrc`, `.ttml`, `.dfxp`, `.rss`, `.atom` | Lines; `.eml`, `.emlx`, `.msg`: passage; `.mbox`: one section per message |
| Notes, whiteboards, mind maps, and design files | `.enex`, `.canvas`, `.excalidraw`, `.tldr`, `.fig`, `.sketch`, `.xmind` | Section per note, frame, page, group, artboard, or mind map sheet |
| Data and configuration | `.csv`, `.tsv`, `.json`, `.jsonl`, `.ndjson`, `.json5`, `.jsonc`, `.hjson`, `.cson`, `.jsonld`, `.geojson`, `.topojson`, `.webmanifest`, `.ipynb`, `.yaml`, `.yml`, `.toml`, `.ini`, `.cfg`, `.conf`, `.cnf`, `.properties`, `.xml`, `.log`, `.example`, `.exemple`, `.sample`, `.template`, `.dist`, `.desktop`, `.service`, `.timer`, `.socket`, `.mount`, `.automount`, `.target`, `.slice`, `.container`, `.volume`, `.network`, `.kube`, `.caddyfile`, `.apacheconf`, `.vhost`, `.vcl`, `.xcconfig`, `.entitlements`, `.plist`, `.code-workspace`, `.code-snippets`, `.hujson`, `.ron`, `.textproto`, `.pbtxt`, `.zon`, `.urdf`, `.xacro`, `.launch`, `.kdl`, `.hocon` | Lines (JSON and YAML: passage; GeoJSON: section per feature) |
| Translations | `.po`, `.pot`, `.xliff`, `.xlf`, `.strings`, `.stringsdict`, `.resx`, `.resw`, `.arb`, `.ftl`, `.xcstrings` | Lines |
| Data models, SQL, and queries | `.cdm`, `.ldm`, `.pdm`, `.oom`, `.bpm`, `.mcd`, `.mpd`, `.mwb`, `.dmd`, `.sql`, `.psql`, `.pgsql`, `.mysql`, `.ddl`, `.dml`, `.pkb`, `.pks`, `.pls`, `.plb`, `.pck`, `.bdy`, `.trg`, `.fnc`, `.prc`, `.dbml`, `.prisma`, `.hql`, `.cql`, `.cypher`, `.sparql`, `.rq`, `.ttl`, `.rdf`, `.owl`, `.edgeql`, `.surql`, `.kql`, `.prql`, `.plsql`, `.cyp`, `.esdl`, `.cds`, `.asddls`, `.xquery`, `.xq`, `.xqm` | Section per object, or lines |
| Diagrams and processes | `.drawio`, `.dio`, `.vsdx`, `.vsdm`, `.vstx`, `.vstm`, `.bpmn`, `.dmn`, `.archimate`, `.xmi`, `.mmd`, `.mermaid`, `.puml`, `.plantuml`, `.pu`, `.iuml`, `.wsd`, `.dsl`, `.d2`, `.dot`, `.gv`, `.graphml`, `.likec4`, `.c4`, `.svg`, `.scxml` | Section per page or object, or lines |
| APIs, schemas, and requests | `.graphql`, `.gql`, `.proto`, `.avsc`, `.thrift`, `.xsd`, `.wsdl`, `.http`, `.rest`, `.hurl`, `.bru`, `.har`, `.raml`, `.smithy`, `.tsp`, `.capnp`, `.fbs`, `.idl`, `.wit`, `.avdl`, `.graphqls`, `.apib`, `.webidl`, `.aidl` | Section per operation or request, or lines |
| BI, reporting, analytics, and ETL | `.twb`, `.twbx`, `.tmdl`, `.pbip`, `.pbir`, `.pbism`, `.bim`, `.jrxml`, `.lkml`, `.malloy`, `.dax`, `.pq`, `.qvs`, `.rdl`, `.rdlc`, `.dtsx`, `.ktr`, `.kjb`, `.yxmd`, `.yxmc`, `.yxwz`, `.sas`, `.sps`, `.do`, `.ado` | Section per object, or lines |
| Code | `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.vue`, `.svelte`, `.astro`, `.marko`, `.css`, `.scss`, `.sass`, `.less`, `.styl`, `.pcss`, `.postcss`, `.py`, `.pyi`, `.pyx`, `.pxd`, `.java`, `.kt`, `.kts`, `.scala`, `.sbt`, `.groovy`, `.gradle`, `.go`, `.rs`, `.zig`, `.nim`, `.c`, `.h`, `.cc`, `.cpp`, `.cxx`, `.hh`, `.hpp`, `.hxx`, `.ino`, `.m`, `.mm`, `.cu`, `.cuh`, `.cs`, `.vb`, `.fs`, `.fsx`, `.fsi`, `.php`, `.rb`, `.rake`, `.gemspec`, `.podspec`, `.swift`, `.dart`, `.lua`, `.r`, `.jl`, `.pl`, `.ex`, `.exs`, `.erl`, `.gleam`, `.hs`, `.cabal`, `.ml`, `.mli`, `.re`, `.sml`, `.elm`, `.purs`, `.clj`, `.cljs`, `.cljc`, `.edn`, `.lisp`, `.lsp`, `.el`, `.scm`, `.ss`, `.rkt`, `.cr`, `.hx`, `.mojo`, `.v`, `.sv`, `.svh`, `.vhd`, `.vhdl`, `.f`, `.for`, `.f77`, `.f90`, `.f95`, `.f03`, `.f08`, `.pas`, `.pp`, `.ada`, `.adb`, `.ads`, `.asm`, `.s`, `.wat`, `.glsl`, `.vert`, `.frag`, `.hlsl`, `.wgsl`, `.metal`, `.sol`, `.move`, `.cairo`, `.vy`, `.cbl`, `.cob`, `.cpy`, `.jcl`, `.pli`, `.rpgle`, `.abap`, `.trigger`, `.cfm`, `.cfc`, `.bas`, `.vbs`, `.tcl`, `.coffee`, `.wl`, `.wls`, `.qml`, `.xaml`, `.axaml`, `.xib`, `.storyboard`, `.ui`, `.vim`, `.ets`, `.bal`, `.cdc`, `.carbon`, `.odin`, `.k`, `.slint`, `.hrl`, `.lhs`, `.mlir`, `.dm`, `.as`, `.al`, `.ceylon`, `.chpl`, `.roc`, `.lean`, `.agda`, `.idr`, `.tla`, `.smt2`, `.dfy`, `.fnl`, `.janet`, `.hy`, `.pony`, `.vala`, `.ls`, `.moon`, `.wren`, `.gd`, `.gdshader`, `.shader`, `.tres`, `.tscn`, `.uc`, `.nut`, `.luau`, `.au3`, `.nu`, `.dpr`, `.lpr`, `.apex`, `.stan`, `.fxml`, `.mxml`, `.glade`, `.xul`, `.c++`, `.h++`, `.cppm`, `.ixx`, `.inl`, `.ipp`, `.tpp`, `.tcc`, `.txx`, `.csx`, `.cake`, `.linq`, `.jsh`, `.gvy`, `.gtpl`, `.sc`, `.es6`, `.jsm`, `.gs`, `.gjs`, `.gts`, `.pm`, `.t`, `.psgi`, `.raku`, `.rakumod`, `.pm6`, `.phpt`, `.pyw`, `.gyp`, `.gypi`, `.wsgi`, `.rpy`, `.spec`, `.rbi`, `.ru`, `.jbuilder`, `.builder`, `.rabl`, `.thor`, `.bats`, `.command`, `.xsh`, `.elv`, `.rockspec`, `.nse`, `.escript`, `.xrl`, `.yrl`, `.hsc`, `.mll`, `.mly`, `.bb`, `.cl`, `.sld`, `.nimble`, `.nims`, `.vapi`, `.pxi`, `.hack`, `.rei`, `.ah2`, `.tm`, `.cobol`, `.rexx`, `.4gl`, `.pc`, `.sqlrpgle`, `.bsl`, `.prolog`, `.qbs`, `.ncl`, `.geom`, `.tesc`, `.tese`, `.comp`, `.rgen`, `.rchit`, `.rmiss`, `.vsh`, `.fsh`, `.hlsli`, `.fx`, `.fxh`, `.cginc`, `.gdshaderinc`, `.wesl`, `.slang`, `.hip`, `.ispc`, `.vh`, `.xdc`, `.fpp`, `.mata`, `.sthlp`, `.nf`, `.smk`, `.cwl`, `.wdl`, `.sage`, `.gnuplot`, `.thy`, `.pde`, `.scad`, `.qs`, `.qasm`, `.circom`, `.nr`, `.clar`, `.cj`, `.c3`, `.ha`, `.mbt`, `.jai`, `.imba`, `.yul`, `.tact`, `.ink`, `.feature`, `.robot`, `.g4`, `.y`, `.l`, `.bison`, `.pegjs`, `.peggy`, `.jq`, `.ql`, `.qll`, `.xsl`, `.xslt`, `.xspec`, `.yar`, `.yara`, `.zeek`, `.sieve` | Lines |
| Web templates | `.hbs`, `.handlebars`, `.mustache`, `.ejs`, `.erb`, `.haml`, `.slim`, `.pug`, `.jade`, `.njk`, `.jinja`, `.jinja2`, `.j2`, `.twig`, `.liquid`, `.cshtml`, `.vbhtml`, `.razor`, `.jsp`, `.jspx`, `.asp`, `.aspx`, `.ascx`, `.gohtml`, `.gotmpl`, `.tmpl`, `.mjml`, `.templ`, `.phtml`, `.ctp`, `.eex`, `.heex`, `.leex`, `.gsp`, `.edge`, `.latte`, `.vtl`, `.jte`, `.mako`, `.soy`, `.riot`, `.svx`, `.vto` | Lines |
| Infrastructure, build, and scripts | `.tf`, `.hcl`, `.tpl`, `.bicep`, `.bicepparam`, `.nomad`, `.rego`, `.sentinel`, `.cue`, `.jsonnet`, `.libsonnet`, `.nix`, `.dhall`, `.pkl`, `.kcl`, `.sls`, `.dockerfile`, `.containerfile`, `.cmake`, `.bzl`, `.bazel`, `.star`, `.mk`, `.mak`, `.ninja`, `.gn`, `.gni`, `.sh`, `.bash`, `.zsh`, `.fish`, `.ksh`, `.csh`, `.tcsh`, `.ps1`, `.psm1`, `.psd1`, `.bat`, `.cmd`, `.awk`, `.sed`, `.ahk`, `.applescript`, `.diff`, `.patch`, `.csproj`, `.fsproj`, `.vbproj`, `.vcxproj`, `.sqlproj`, `.shproj`, `.wixproj`, `.proj`, `.props`, `.targets`, `.nuspec`, `.sln`, `.slnx`, `.natvis`, `.vsixmanifest`, `.vstemplate`, `.ps1xml`, `.wxs`, `.wxi`, `.wxl`, `.iss`, `.nsi`, `.nsh`, `.tofu`, `.tftpl`, `.make`, `.just`, `.ld`, `.td`, `.ebuild`, `.eclass`, `.bbappend`, `.bbclass` | Lines |
| Security and compliance reports | `.sarif`, `.spdx` | Section per finding (SARIF), or lines |
| Project files without an extension | `AUTHORS`, `CHANGELOG`, `CHANGES`, `CITATION`, `CITATION.cff`, `CODEOWNERS`, `CONTRIBUTORS`, `COPYING`, `HISTORY`, `LICENCE`, `LICENSE`, `NEWS`, `NOTICE`, `OWNERS`, `README`, `TODO` | Lines |
| Build and automation files | `Appfile`, `Berksfile`, `Brewfile`, `BUILD`, `Caddyfile`, `Capfile`, `Cartfile`, `Containerfile`, `Dangerfile`, `Dockerfile`, `Earthfile`, `Fastfile`, `Gemfile`, `GNUmakefile`, `Gradlew`, `Guardfile`, `Jenkinsfile`, `Justfile`, `Makefile`, `Matchfile`, `Mvnw`, `Pipfile`, `Podfile`, `Procfile`, `Rakefile`, `Snakefile`, `Tiltfile`, `Vagrantfile`, `WORKSPACE`, and variants such as `Dockerfile.*`, `Containerfile.*`, `Jenkinsfile.*`, `Makefile.*`, `Android.bp`, `APKBUILD`, `Appraisals`, `BSDmakefile`, `BUCK`, `Buildfile`, `cabal.project`, `Cakefile`, `Cask`, `configure.ac`, `cpanfile`, `Deliverfile`, `DEPS`, `dune-project`, `Eask`, `Emakefile`, `firestore.rules`, `go.mod`, `go.work`, `Jakefile`, `Jarfile`, `Kbuild`, `kcl.mod`, `MANIFEST.MF`, `Mavenfile`, `meson.build`, `mkfile`, `Modulefile`, `nextflow.config`, `Phakefile`, `PKGBUILD`, `project.godot`, `Puppetfile`, `rebar.config`, `Rexfile`, `SConscript`, `SConstruct`, `Singularity`, `Snapfile`, `Steepfile`, `Thorfile`, `wscript` | Lines |
| Tool configuration files | `.babelrc`, `.browserslistrc`, `.clang-format`, `.clang-tidy`, `.clangd`, `.containerignore`, `.dockerignore`, `.editorconfig`, `.eslintignore`, `.eslintrc`, `.flake8`, `.gcloudignore`, `.gitattributes`, `.gitignore`, `.gitmodules`, `.helmignore`, `.htaccess`, `.mailmap`, `.node-version`, `.npmignore`, `.nvmrc`, `.prettierignore`, `.prettierrc`, `.pylintrc`, `.python-version`, `.ruby-version`, `.stylelintignore`, `.stylelintrc`, `.swcrc`, `.terraform-version`, `.tool-versions`, `.vscodeignore`, `.all-contributorsrc`, `.arcconfig`, `.autorc`, `.buckconfig`, `.c8rc`, `.codespellrc`, `.coveragerc`, `.gitreview`, `.htmlhintrc`, `.irbrc`, `.jscsrc`, `.jshintrc`, `.jslintrc`, `.justfile`, `.latexmkrc`, `.luacheckrc`, `.nycrc`, `.pryrc`, `.releaserc`, `.Rprofile`, `.rspec`, `.shellcheckrc`, `.simplecov`, `.tern-config`, `.tern-project`, `.watchmanconfig`, `.yardopts`, `_redirects`, `browserslist`, `latexmkrc`, `mocha.opts`, `pylintrc` | Lines |
| With a local extractor (optional) | Scanned PDF pages; images `.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.webp`, `.gif`, `.bmp`, `.heic`, `.heif`, `.avif`; legacy Word `.doc` | Page or passage |

Dotenv templates such as `.env.example`, `.env.sample`, or `env.template` keep their variable
names and comments, each on its own line, with every value masked; `.env` and every other `.env.*`
file stay skipped as secrets, like Terraform state and variable files (`.tfstate`, `.tfvars`) and
the Firebase `GoogleService-Info.plist`.

Markdown sections follow the headings, and each passage carries its heading path. YAML (`---`)
or TOML (`+++`) front matter at the top of a page stays one passage, read as data and never run;
on a page without a level-1 heading, as Astro, Docusaurus, and Hugo write them, its `title` roots
every section's path, and `ragmir_sources` lists the page's `title` and `description`.

Office charts are indexed with their titles, axes, series, and values. Text files keep their own
encoding: a UTF-16 byte order mark selects UTF-16, and bytes that are not valid UTF-8 are read as
Windows-1252, so legacy CSV files, subtitles, and Apple string tables index correctly. Other text
extensions can be added with `includeExtensions` in the [configuration](./configuration.md).
Binary formats outside this list are reported, never guessed.

## Structured exports in detail

| Tool or standard | Files | What each section holds |
| --- | --- | --- |
| PowerDesigner | `.cdm`, `.ldm`, `.pdm`, `.oom`, `.bpm`, `.mcd`, `.mpd`, or `.xml` saved as XML | Entities, tables, views, associations, references, inheritances, domains, business rules, classes, and packages, with columns or attributes, types, comments, keys, indexes, joins, and the objects that reference them |
| ERwin Data Modeler | XML export (`.xml`) | Entities, attributes with physical names and types, relationships |
| MySQL Workbench | `.mwb` | Tables, columns, foreign keys, indexes, views, routines |
| Oracle SQL Developer Data Modeler | object `.xml` files in the design folder | Entities, tables, and their attributes or columns with comments |
| draw.io / diagrams.net | `.drawio`, `.dio`, `.drawio.svg`, or `.xml` | One section per page: shape labels, custom properties, containers, and connections |
| Visio | `.vsdx`, `.vsdm`, `.vstx`, `.vstm` | One section per page: shape text and connectors |
| BPMN 2.0 | `.bpmn` or `.xml` | Processes with lanes, steps, documentation, flows, and conditions; collaborations |
| DMN | `.dmn` or `.xml` | Decisions with hit policy, inputs, outputs, every rule, and requirements |
| ArchiMate | `.archimate` (Archi) or Open Group exchange `.xml` | Elements with documentation, properties, and relations |
| UML | `.xmi` or `.xml` | Classes, interfaces, enumerations, components, actors, use cases, attributes, operations, generalizations, notes |
| Figma, FigJam, Figma Slides | `.fig` saved with "Save local copy", or the file JSON of the REST API | One section per top-level frame, section, component, or slide of each page: text layers, instance text overrides, component descriptions; loose stickies and text per page |
| Sketch | `.sketch` | One section per artboard or symbol: text layers and symbol text overrides |
| Excalidraw | `.excalidraw`, or a `.json` scene | One section per frame and one for the rest of the canvas: text, labelled shapes, labelled arrows, links |
| tldraw | `.tldr` | One section per page: frame names, text and notes in reading order, bound arrows |
| JSON Canvas (Obsidian) | `.canvas` | One section per group and one for ungrouped cards: text, file and link cards, labelled edges |
| XMind | `.xmind` from XMind 8, or XMind 2020 and later | One section per sheet: the topic outline with notes, labels, task and priority markers, web links, floating, callout, and summary topics, and labelled relationships |
| Tableau | `.twb`, `.twbx` | Data sources with fields and calculated formulas, worksheets, dashboards |
| OpenAPI, Swagger, AsyncAPI | `.yaml`, `.yml`, `.json` | API overview, each operation (`GET /invoices/{id}`), channel, message, and schema |
| Postman | collection v2.0 or v2.1 `.json` | Collection overview, folders, and one section per request: method, URL, description, parameters, headers, body, example responses; secret header values left out |
| Insomnia | v4 `.json` export or v5 `.yaml` collection | Workspace, then one section per request with its folder path; environments are not indexed |
| HTTP Archive (HAR) | `.har` saved from browser DevTools, Charles, Proxyman, or Fiddler | An overview, then one section per API or page request: method, URL, status, query parameters, headers, and text bodies, with identical repeated requests counted once; cookies, credentials, tokens, and secret-like parameters left out, and static assets and CORS preflights skipped |
| Power BI project | `.tmdl`, `.pbip`, `.pbir`, `.pbism`, `.bim` | TMDL as text with line citations, PBIR and TMSL as JSON |
| Email | `.eml`, `.emlx`, `.msg` | Subject, sender, recipients, date, attachment names, and the decoded body: quoted-printable and base64 parts in their charset, HTML rendered as text, forwarded messages included |
| Mailbox | `.mbox` (Gmail Takeout, Thunderbird, Apple Mail export) | One section per message, labelled with its number and subject |
| Saved web page | `.mhtml`, `.mht` | Page title, address, and the rendered page; images are skipped |
| Evernote | `.enex` | One section per note: title, tags, dates, author, source address, attachment names, and the rendered body |
| FictionBook | `.fb2` | Book description, then one section per chapter |
| GeoJSON | `.geojson`, or a `.json` feature collection | One section per feature: its name, geometry type, point coordinates, and properties |
| SARIF | `.sarif` from CodeQL, Semgrep, ESLint, and other analyzers | One section per finding: rule, level, message, locations, and rule description |
| Flat OpenDocument | `.fodt`, `.fods`, `.fodp`, `.fodg` | Metadata and body, without styles and settings |

## How detection works

A file with a dedicated extension uses its extractor. A generic `.xml` file is read as structured
only when its first bytes identify the tool: the PowerDesigner processing instruction, or the root
element and namespace of draw.io, BPMN, DMN, ArchiMate, XMI, MySQL Workbench, Oracle Data
Modeler, ERwin, or Tableau. Any other XML file, such as a Maven `pom.xml`, keeps line citations. A
`.json` or `.yaml` file is read as structured only when its shape identifies an OpenAPI or AsyncAPI
description, a Postman or Insomnia collection, a Figma file, an Excalidraw or tldraw document, a
GeoJSON feature collection, a SARIF log, or a JSON Canvas; any other JSON keeps its plain text.

## Exports that need one step first

- **PowerDesigner binary models.** Save the model in XML format. Ragmir reports a binary model as a
  file error and keeps indexing the rest of the corpus. PowerDesigner backups (`.bcd`, `.bpd`) are
  not indexed because they duplicate the model.
- **Oracle SQL Developer Data Modeler.** The `.dmd` file only points to the design folder. Add the
  folder next to it to your sources so the object files are indexed.
- **Power BI `.pbix`.** The model is stored in a compressed binary part. Save the report as a Power
  BI project (PBIP) with the TMDL format and index the project folder.
- **Enterprise Architect `.qea` and `.eap`.** These are databases. Export the model to XMI.
- **Figma in the browser.** Use "Save local copy" to get a `.fig` file, or save the file JSON of the
  REST API (`GET /v1/files/:key`). Zstandard-compressed `.fig` files need Node.js 22.15 or later.
- **Apple Pages, Numbers, and Keynote.** Export to Word, Excel, PowerPoint, or PDF.
- **OneNote, Google Docs, Notion, and Confluence.** Export to Word, PDF, HTML, or Markdown; Google
  Takeout and Notion exports already use these formats.
- **Legacy `.xls` and `.ppt`, and binary `.xlsb` workbooks.** Convert to `.xlsx`, `.pptx`, CSV, or
  PDF.
- **Binary property lists.** Xcode writes `.plist` files as XML, which index with line citations.
  A binary one is reported as a file error: save an XML copy with
  `plutil -convert xml1 -o copy.plist <file>` and index the copy.
- **Password-protected XMind maps.** Save a copy without a password; Ragmir reports the protected
  map as a file error.

## Limits

One file produces at most 20,000 sections; a last section records how many objects were left out.
A compressed draw.io page expands to at most 25 MB, and a Figma document to at most 256 MB.
Archives (`.mwb`, `.vsdx`, `.twbx`, `.sketch`, `.xmind`) use the same entry-count and size limits
as Office files, and a mind map is read 64 topic levels deep, with deeper branches counted. A mail part is indexed up to 2 million characters; binary attachments are listed by name.
Files larger than `maxFileBytes` (50 MB at most) are skipped, so split large mailboxes by year or
label before indexing them. A damaged file is reported in the ingestion errors and does not stop
ingestion.

After an upgrade, the next `rgr ingest` stages a rebuild with the new extractors and activates it
only once it passes validation. The previous index stays searchable meanwhile, and
`.ragmir/storage/` never needs to be deleted.
