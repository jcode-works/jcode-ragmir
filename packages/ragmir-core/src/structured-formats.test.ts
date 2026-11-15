import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { deflateRawSync } from "node:zlib"
import { strToU8, zipSync } from "fflate"
import { afterEach, describe, expect, it } from "vitest"
import { citationForCoordinates } from "./citation.js"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { parseFile } from "./parsing.js"
import { search } from "./query.js"
import type { ParsedDocument, SourceFile } from "./types.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("structured exports", () => {
  it("cites PowerDesigner conceptual objects with their attributes and links", async () => {
    const parsed = await parseFixture("billing.cdm", powerDesignerConceptualModel())

    expect(sectionLabels(parsed)).toEqual([
      "Model BILLING",
      "Entity BIL_INVOICE",
      "Entity BIL_CUSTOMER",
      "Association BILLS",
    ])
    const invoice = sectionText(parsed, "Entity BIL_INVOICE")
    expect(invoice).toContain("Entity: Invoice (BIL_INVOICE)")
    expect(invoice).toContain("Comment: Customer invoice issued monthly")
    expect(invoice).toContain(
      "- Due date (INVDUE_DATE): mandatory; Type: D; Comment: Payment deadline, 30 days after issue",
    )
    expect(sectionText(parsed, "Entity BIL_CUSTOMER")).toContain(
      "- Association Bills (BILLS) (Cardinality: 0,n)",
    )
    // Diagram symbols and geometry stay out of the index.
    expect(parsed.text).not.toContain("Rect")
    expect(parsed.text).not.toContain("Main diagram")
  })

  it("cites PowerDesigner physical tables, keys, and references", async () => {
    const parsed = await parseFixture("billing.pdm", powerDesignerPhysicalModel())
    const table = sectionText(parsed, "Table BIL_INVOICE")

    expect(table).toContain(
      "- Due date (INVDUE_DATE): Type: DATE; Comment: Payment deadline; mandatory",
    )
    expect(table).toContain(
      "- Primary (PK_INVOICE): Constraint: PAC_PK_INVOICE; Key columns: Invoice id (INVID)",
    )
    expect(table).toContain("Referenced by:\n- Reference Customer invoices (FK_INVOICE_CUSTOMER)")
    const reference = sectionText(parsed, "Reference FK_INVOICE_CUSTOMER")
    expect(reference).toContain("Parent table: Customer (BIL_CUSTOMER)")
    expect(reference).toContain("Child table: Invoice (BIL_INVOICE)")
    expect(reference).toContain("- Customer id (CUSID) = Customer id (INVCUS_ID)")
  })

  it("detects a PowerDesigner model saved with a generic .xml extension", async () => {
    const parsed = await parseFixture("model.xml", powerDesignerPhysicalModel())

    expect(parsed.sourceLineCoordinates).toBe(false)
    expect(sectionLabels(parsed)).toContain("Table BIL_INVOICE")
  })

  it("keeps generic XML as line-cited text", async () => {
    const xml = '<?xml version="1.0"?>\n<project>\n  <name>billing-service</name>\n</project>\n'
    const parsed = await parseFixture("pom.xml", xml)

    expect(parsed.regions).toBeUndefined()
    expect(parsed.sourceLineCoordinates).toBe(true)
    expect(parsed.text).toContain("<name>billing-service</name>")
  })

  it("explains that a binary PowerDesigner model must be saved as XML", async () => {
    await expect(
      parseFixture("legacy.pdm", Buffer.from([0x00, 0x01, 0x02, 0x50, 0x44, 0x00])),
    ).rejects.toThrow("PowerDesigner model is saved in binary format")
  })

  it("reads ERwin entities, attributes, and relationships", async () => {
    const parsed = await parseFixture(
      "erwin-export.xml",
      `<?xml version="1.0"?>
<ERwin4 xmlns="http://www.ca.com/erwin/data">
  <Model id="m1">
    <Entity id="e1" name="CUSTOMER">
      <EntityProps><Physical_Name>T_CUSTOMER</Physical_Name><Definition>A paying account</Definition></EntityProps>
      <Attribute_Groups>
        <Attribute id="a1" name="customer_id">
          <AttributeProps><Physical_Data_Type>NUMBER(10)</Physical_Data_Type><Definition>Account number</Definition></AttributeProps>
        </Attribute>
      </Attribute_Groups>
    </Entity>
    <Entity id="e2" name="ORDER"><EntityProps><Definition>A purchase</Definition></EntityProps></Entity>
    <Relationship id="r1" name="places">
      <RelationshipProps><Parent_Entity>e1</Parent_Entity><Child_Entity>e2</Child_Entity><Verb_Phrase>places</Verb_Phrase></RelationshipProps>
    </Relationship>
  </Model>
</ERwin4>`,
    )

    expect(sectionText(parsed, "Entity T_CUSTOMER")).toContain(
      "- customer_id: type: NUMBER(10); definition: Account number",
    )
    const relationship = sectionText(parsed, "Relationship places")
    expect(relationship).toContain("Parent: CUSTOMER")
    expect(relationship).toContain("Child: ORDER")
  })

  it("reads MySQL Workbench tables, columns, and foreign keys", async () => {
    const document = `<?xml version="1.0"?>
<data grt_format="2.0" document_type="MySQL Workbench Model" version="1.4.4">
  <value type="object" struct-name="db.mysql.Table" id="t1">
    <value type="string" key="name">customers</value>
    <value type="string" key="comment">Accounts that can be invoiced</value>
    <value type="list" content-type="object" key="columns">
      <value type="object" struct-name="db.mysql.Column" id="c1">
        <value type="string" key="name">id</value>
        <link type="object" struct-name="db.SimpleDatatype" key="simpleType">com.mysql.rdbms.mysql.datatype.int</link>
        <value type="int" key="isNotNull">1</value>
      </value>
    </value>
  </value>
  <value type="object" struct-name="db.mysql.Table" id="t2">
    <value type="string" key="name">invoices</value>
    <value type="list" content-type="object" key="columns">
      <value type="object" struct-name="db.mysql.Column" id="c2">
        <value type="string" key="name">customer_id</value>
        <link type="object" struct-name="db.SimpleDatatype" key="simpleType">com.mysql.rdbms.mysql.datatype.int</link>
      </value>
    </value>
    <value type="list" content-type="object" key="foreignKeys">
      <value type="object" struct-name="db.mysql.ForeignKey" id="f1">
        <value type="string" key="name">fk_invoice_customer</value>
        <link type="object" struct-name="db.mysql.Table" key="referencedTable">t1</link>
        <value type="list" content-type="object" key="columns"><link type="object">c2</link></value>
        <value type="list" content-type="object" key="referencedColumns"><link type="object">c1</link></value>
      </value>
    </value>
  </value>
</data>`
    const parsed = await parseFixture(
      "shop.mwb",
      Buffer.from(
        zipSync({ "document.mwb.xml": strToU8(document), "@db/data.db": new Uint8Array([0, 1]) }),
      ),
    )

    expect(sectionText(parsed, "Table customers")).toContain("- id: int; not null")
    expect(sectionText(parsed, "Table invoices")).toContain(
      "- fk_invoice_customer: (customer_id) references customers(id)",
    )
  })

  it("reads Oracle Data Modeler object files", async () => {
    const parsed = await parseFixture(
      "8D2F.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
<Table class="oracle.dbtools.crest.model.design.relational.Table" id="8D2F" name="EMPLOYEES">
  <commentInRDBMS>People on the payroll</commentInRDBMS>
  <columns itemClass="oracle.dbtools.crest.model.design.relational.Column">
    <Column name="HIRE_DATE" id="C1"><dataTypeSize>7</dataTypeSize><nullsAllowed>false</nullsAllowed><commentInRDBMS>First working day</commentInRDBMS></Column>
  </columns>
</Table>`,
    )

    const table = sectionText(parsed, "Table EMPLOYEES")
    expect(table).toContain("Comment: People on the payroll")
    expect(table).toContain("- Column HIRE_DATE: size: 7; not null; comment: First working day")
  })

  it("reads draw.io pages, including compressed pages and editable SVG", async () => {
    const page = `<mxGraphModel><root>
      <mxCell id="0"/><mxCell id="1" parent="0"/>
      <object id="api" label="&lt;b&gt;Billing API&lt;/b&gt;" owner="payments team"><mxCell vertex="1" parent="1" style="rounded=1"><mxGeometry x="10" y="10" width="80" height="40" as="geometry"/></mxCell></object>
      <mxCell id="db" value="Invoices DB" vertex="1" parent="1" style="shape=cylinder"/>
      <mxCell id="e1" value="writes" edge="1" parent="1" source="api" target="db"/>
    </root></mxGraphModel>`
    const compressed = deflateRawSync(Buffer.from(encodeURIComponent(page))).toString("base64")
    const drawio = `<mxfile host="app.diagrams.net"><diagram name="Overview" id="p1">${page}</diagram><diagram name="Archive" id="p2">${compressed}</diagram></mxfile>`

    const parsed = await parseFixture("architecture.drawio", drawio)
    expect(sectionLabels(parsed)).toEqual(["Page Overview", "Page Archive"])
    for (const label of ["Page Overview", "Page Archive"]) {
      const text = sectionText(parsed, label)
      expect(text).toContain("- Billing API (owner: payments team)")
      expect(text).toContain("- Invoices DB")
      expect(text).toContain("- Billing API -> Invoices DB: writes")
    }
    expect(parsed.text).not.toContain("rounded=1")
    expect(parsed.text).not.toContain("mxGeometry")

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="${escapeXml(drawio)}"><g/></svg>`
    const fromSvg = await parseFixture("architecture.drawio.svg", svg)
    expect(sectionLabels(fromSvg)).toEqual(["Page Overview", "Page Archive"])
    const plainSvg = await parseFixture(
      "icon.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"><title>Logo</title></svg>',
    )
    expect(plainSvg.regions).toBeUndefined()
  })

  it("rejects a corrupted compressed draw.io page", async () => {
    await expect(
      parseFixture(
        "broken.drawio",
        '<mxfile><diagram name="Bad">bm90IGRlZmxhdGU=</diagram></mxfile>',
      ),
    ).rejects.toThrow()
  })

  it("reads Visio pages with shape text and connectors", async () => {
    const pages = `<?xml version="1.0"?><Pages xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><Page ID="0" NameU="Checkout flow"><Rel r:id="rId1"/></Page></Pages>`
    const rels = `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="page1.xml"/></Relationships>`
    const page = `<?xml version="1.0"?><PageContents><Shapes>
      <Shape ID="1"><Text>Cart</Text></Shape>
      <Shape ID="2"><Text>Payment</Text></Shape>
      <Shape ID="3"><Text>confirm</Text></Shape>
    </Shapes><Connects>
      <Connect FromSheet="3" FromCell="BeginX" ToSheet="1"/>
      <Connect FromSheet="3" FromCell="EndX" ToSheet="2"/>
    </Connects></PageContents>`
    const parsed = await parseFixture(
      "flows.vsdx",
      Buffer.from(
        zipSync({
          "visio/pages/pages.xml": strToU8(pages),
          "visio/pages/_rels/pages.xml.rels": strToU8(rels),
          "visio/pages/page1.xml": strToU8(page),
        }),
      ),
    )

    const text = sectionText(parsed, "Page Checkout flow")
    expect(text).toContain("- Cart")
    expect(text).toContain("- Cart -> Payment: confirm")
  })

  it("reads BPMN processes and DMN decision tables", async () => {
    const bpmn = await parseFixture(
      "refund.bpmn",
      `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI">
  <bpmn:process id="refund" name="Refund request">
    <bpmn:startEvent id="s" name="Request received"/>
    <bpmn:userTask id="review" name="Review refund"><bpmn:documentation>Finance checks the receipt</bpmn:documentation></bpmn:userTask>
    <bpmn:exclusiveGateway id="g" name="Above 500 EUR?"/>
    <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="review"/>
    <bpmn:sequenceFlow id="f2" sourceRef="review" targetRef="g" name="checked"><bpmn:conditionExpression>amount &gt; 500</bpmn:conditionExpression></bpmn:sequenceFlow>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="d"><bpmndi:BPMNPlane id="p"/></bpmndi:BPMNDiagram>
</bpmn:definitions>`,
    )
    const process = sectionText(bpmn, "Process Refund request")
    expect(process).toContain("- User task: Review refund (Finance checks the receipt)")
    expect(process).toContain("- Review refund -> Above 500 EUR?: checked when amount > 500")

    const dmn = await parseFixture(
      "approval.dmn",
      `<?xml version="1.0"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="d" name="Approvals">
  <decision id="level" name="Approval level">
    <decisionTable hitPolicy="FIRST">
      <input label="Amount"><inputExpression><text>amount</text></inputExpression></input>
      <output name="approver" label="Approver"/>
      <rule><inputEntry><text>&lt;= 500</text></inputEntry><outputEntry><text>"Manager"</text></outputEntry></rule>
      <rule><inputEntry><text>&gt; 500</text></inputEntry><outputEntry><text>"CFO"</text></outputEntry></rule>
    </decisionTable>
  </decision>
</definitions>`,
    )
    const decision = sectionText(dmn, "Decision Approval level")
    expect(decision).toContain("Hit policy: FIRST")
    expect(decision).toContain('Rule 2: > 500 => "CFO"')
  })

  it("reads ArchiMate elements and relations from Archi and exchange files", async () => {
    const archi = await parseFixture(
      "landscape.archimate",
      `<?xml version="1.0" encoding="UTF-8"?>
<archimate:model xmlns:archimate="http://www.archimatetool.com/archimate" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" name="Landscape">
  <folder name="Business"><element xsi:type="archimate:BusinessActor" name="Customer" id="a1"><documentation>Buys subscriptions</documentation></element></folder>
  <folder name="Application"><element xsi:type="archimate:ApplicationComponent" name="Billing" id="a2"><property key="owner" value="Finance"/></element></folder>
  <folder name="Relations"><element xsi:type="archimate:ServingRelationship" id="r1" source="a2" target="a1"/></folder>
  <folder name="Views"><element xsi:type="archimate:ArchimateDiagramModel" name="Main view" id="v1"/></folder>
</archimate:model>`,
    )
    expect(sectionText(archi, "Application component Billing")).toContain("- Serving -> Customer")
    expect(sectionText(archi, "Business actor Customer")).toContain(
      "Documentation: Buys subscriptions",
    )
    expect(archi.text).not.toContain("Main view")

    const exchange = await parseFixture(
      "landscape.xml",
      `<?xml version="1.0"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="m">
  <elements>
    <element identifier="e1" xsi:type="BusinessProcess"><name xml:lang="en">Invoice customers</name></element>
    <element identifier="e2" xsi:type="DataObject"><name xml:lang="en">Invoice</name></element>
  </elements>
  <relationships><relationship identifier="r1" source="e1" target="e2" xsi:type="Access"/></relationships>
</model>`,
    )
    expect(sectionText(exchange, "Business process Invoice customers")).toContain(
      "- Access -> Invoice",
    )
  })

  it("reads UML classes from XMI", async () => {
    const parsed = await parseFixture(
      "domain.xmi",
      `<?xml version="1.0"?>
<xmi:XMI xmi:version="2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1">
  <uml:Model xmi:type="uml:Model" name="Domain" xmi:id="m">
    <packagedElement xmi:type="uml:Class" xmi:id="c1" name="Invoice">
      <ownedComment xmi:id="n1" body="Issued once a month"/>
      <ownedAttribute xmi:id="p1" name="total" type="t1"/>
      <ownedOperation xmi:id="o1" name="pay"><ownedParameter xmi:id="r1" name="amount" type="t1"/></ownedOperation>
      <generalization xmi:id="g1" general="c2"/>
    </packagedElement>
    <packagedElement xmi:type="uml:Class" xmi:id="c2" name="Document"/>
    <packagedElement xmi:type="uml:DataType" xmi:id="t1" name="Money"/>
  </uml:Model>
</xmi:XMI>`,
    )

    const invoice = sectionText(parsed, "Class Invoice")
    expect(invoice).toContain("Note: Issued once a month")
    expect(invoice).toContain("Extends: Document")
    expect(invoice).toContain("- total: Money")
    expect(invoice).toContain("- pay(amount: Money)")
  })

  it("reads Tableau workbooks and packaged workbooks", async () => {
    const workbook = `<?xml version="1.0"?>
<workbook source-build="2024.1.0" version="18.1">
  <datasources>
    <datasource caption="Sales" name="federated.1">
      <connection class="postgres" dbname="analytics"/>
      <column caption="Margin" datatype="real" name="[Calc_1]" role="measure"><calculation class="tableau" formula="SUM([Profit])/SUM([Sales])"/></column>
    </datasource>
  </datasources>
  <worksheets><worksheet name="Margin by region"><table><view><datasources><datasource caption="Sales" name="federated.1"/></datasources></view><rows>[Region]</rows><cols>[Margin]</cols></table></worksheet></worksheets>
  <dashboards><dashboard name="Executive"><zones><zone name="Margin by region"/></zones></dashboard></dashboards>
</workbook>`
    const parsed = await parseFixture("sales.twb", workbook)
    expect(sectionText(parsed, "Data source Sales")).toContain(
      "- Margin: real; measure; formula SUM([Profit])/SUM([Sales])",
    )
    expect(sectionText(parsed, "Worksheet Margin by region")).toContain("Rows: [Region]")
    expect(sectionText(parsed, "Dashboard Executive")).toContain("Sheets: Margin by region")

    const packaged = await parseFixture(
      "sales.twbx",
      Buffer.from(
        zipSync({ "sales.twb": strToU8(workbook), "Data/extract.hyper": new Uint8Array([1]) }),
      ),
    )
    expect(sectionLabels(packaged)).toContain("Dashboard Executive")
  })

  it("splits OpenAPI and AsyncAPI descriptions by operation and channel", async () => {
    const openApi = await parseFixture(
      "billing-api.yaml",
      [
        "openapi: 3.1.0",
        "info:",
        "  title: Billing API",
        "  version: 2.0.0",
        "paths:",
        "  /invoices/{id}:",
        "    parameters:",
        "      - name: id",
        "        in: path",
        "    get:",
        "      summary: Read one invoice",
        "      responses:",
        "        '404':",
        "          description: Invoice not found",
        "components:",
        "  schemas:",
        "    Invoice:",
        "      type: object",
      ].join("\n"),
    )
    expect(sectionLabels(openApi)).toEqual([
      "API Billing API",
      "GET /invoices/{id}",
      "Schema Invoice",
    ])
    const operation = sectionText(openApi, "GET /invoices/{id}")
    expect(operation).toContain("summary: Read one invoice")
    expect(operation).toContain("name: id")
    expect(operation).toContain("description: Invoice not found")

    const asyncApi = await parseFixture(
      "events.json",
      JSON.stringify({
        asyncapi: "3.0.0",
        info: { title: "Billing events", version: "1.0.0" },
        channels: { invoicePaid: { address: "invoice.paid" } },
        operations: { onInvoicePaid: { action: "receive" } },
      }),
    )
    expect(sectionLabels(asyncApi)).toEqual([
      "AsyncAPI Billing events",
      "Channel invoicePaid",
      "Operation onInvoicePaid",
    ])

    const plain = await parseFixture("settings.yaml", "retries: 3\n")
    expect(plain.regions).toBeUndefined()
  })

  it("reads Outlook messages with headers, recipients, attachments, and body", async () => {
    const parsed = await parseFixture("refund.msg", outlookMessage())

    expect(parsed.text).toContain("Subject: Refund approved")
    expect(parsed.text).toContain("From: Finance Desk <finance@example.com>")
    expect(parsed.text).toContain("To: Alex Martin")
    expect(parsed.text).toContain("Date: 2026-03-02T09:30:00.000Z")
    expect(parsed.text).toContain("Attachments: receipt.pdf")
    expect(parsed.text).toContain(
      `The refund of 480 EUR is approved.${" Details follow.".repeat(300)}`,
    )
  })

  it("rejects a file that is not an Outlook message", async () => {
    await expect(parseFixture("fake.msg", "Subject: plain text")).rejects.toThrow(
      "OLE compound file signature",
    )
  })

  it("cites structured objects in search results and keeps going past a broken file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-structured-ingest-"))
    tempDirs.push(root)
    await initProject(root)
    const raw = path.join(root, ".ragmir", "raw")
    await mkdir(raw, { recursive: true })
    await writeFile(path.join(raw, "billing.pdm"), powerDesignerPhysicalModel())
    await writeFile(path.join(raw, "broken.vsdx"), "not a zip")
    await writeFile(
      path.join(raw, "pac_billing.pkb"),
      [
        "CREATE OR REPLACE PACKAGE BODY pac_billing AS",
        "  -- Close the accounting period once every invoice is paid.",
        "  PROCEDURE close_period IS BEGIN NULL; END;",
        "END pac_billing;",
      ].join("\n"),
    )

    const result = await ingest({ cwd: root })
    expect(result.errors).toEqual([expect.objectContaining({ path: ".ragmir/raw/broken.vsdx" })])

    const tables = await search("invoice due date payment deadline column", {
      cwd: root,
      topK: 5,
      contextRadius: 0,
    })
    expect(tables.map((entry) => entry.citation)).toContainEqual(
      expect.stringContaining("billing.pdm:section=Table%20BIL_INVOICE#"),
    )
    const plsql = await search("close the accounting period procedure", {
      cwd: root,
      topK: 5,
      contextRadius: 0,
    })
    expect(plsql.map((entry) => entry.citation)).toContainEqual(
      expect.stringMatching(/pac_billing\.pkb:L1-L4#0$/u),
    )
  })

  it("formats section citations", () => {
    expect(
      citationForCoordinates({
        relativePath: "models/billing.pdm",
        chunkIndex: 3,
        locationKind: "section",
        locationStart: 2,
        locationEnd: 2,
        locationLabel: "Table BIL_INVOICE",
      }),
    ).toBe("models/billing.pdm:section=Table%20BIL_INVOICE#3")
  })
})

async function parseFixture(name: string, content: string | Buffer): Promise<ParsedDocument> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-structured-"))
  tempDirs.push(root)
  const filePath = path.join(root, name)
  await writeFile(filePath, content)
  return parseFile(sourceFile(root, filePath))
}

function sourceFile(root: string, absolutePath: string): SourceFile {
  return {
    absolutePath,
    relativePath: path.relative(root, absolutePath),
    source: path.basename(absolutePath),
    extension: path.extname(absolutePath).toLowerCase(),
    bytes: 0,
    mtimeMs: 0,
    checksum: "test",
  }
}

function sectionLabels(parsed: ParsedDocument): string[] {
  return (parsed.regions ?? []).map((region) => region.location.label ?? "")
}

function sectionText(parsed: ParsedDocument, label: string): string {
  const region = parsed.regions?.find((entry) => entry.location.label === label)
  if (!region) {
    throw new Error(`Missing section ${label}: ${sectionLabels(parsed).join(", ")}`)
  }
  expect(region.location.kind).toBe("section")
  return parsed.text.slice(region.charStart, region.charEnd)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
}

function powerDesignerConceptualModel(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<?PowerDesigner AppLocale="UTF16" Name="Billing" signature="CDM_DATA_MODEL_XML" version="16.7.5"?>
<Model xmlns:a="attribute" xmlns:c="collection" xmlns:o="object">
<o:RootObject Id="o1"><c:Children><o:Model Id="o2">
<a:ObjectID>0D0F</a:ObjectID><a:Name>Billing</a:Name><a:Code>BILLING</a:Code>
<c:DefaultDiagram><o:ConceptualDiagram Ref="o40"/></c:DefaultDiagram>
<c:ConceptualDiagrams><o:ConceptualDiagram Id="o40"><a:Name>Main diagram</a:Name><c:Symbols><o:EntitySymbol Id="o41"><a:Rect>((0,0), (100,100))</a:Rect></o:EntitySymbol></c:Symbols></o:ConceptualDiagram></c:ConceptualDiagrams>
<c:Entities>
<o:Entity Id="o10"><a:Name>Invoice</a:Name><a:Code>BIL_INVOICE</a:Code><a:CreationDate>1749129598</a:CreationDate><a:Comment>Customer invoice issued monthly</a:Comment>
<c:Attributes><o:EntityAttribute Id="o11"><a:BaseAttribute.Mandatory>1</a:BaseAttribute.Mandatory><c:DataItem><o:DataItem Ref="o20"/></c:DataItem></o:EntityAttribute></c:Attributes>
</o:Entity>
<o:Entity Id="o12"><a:Name>Customer</a:Name><a:Code>BIL_CUSTOMER</a:Code></o:Entity>
</c:Entities>
<c:Associations><o:Association Id="o30"><a:Name>Bills</a:Name><a:Code>BILLS</a:Code></o:Association></c:Associations>
<c:AssociationLinks><o:AssociationLink Id="o31"><a:Cardinality>0,n</a:Cardinality><c:Object1><o:Association Ref="o30"/></c:Object1><c:Object2><o:Entity Ref="o12"/></c:Object2></o:AssociationLink></c:AssociationLinks>
<c:DataItems><o:DataItem Id="o20"><a:Name>Due date</a:Name><a:Code>INVDUE_DATE</a:Code><a:Comment>Payment deadline, 30 days after issue</a:Comment><a:DataType>D</a:DataType></o:DataItem></c:DataItems>
</o:Model></c:Children></o:RootObject></Model>`
}

function powerDesignerPhysicalModel(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<?PowerDesigner AppLocale="UTF16" Name="Billing" signature="PDM_DATA_MODEL_XML" version="16.7.5"?>
<Model xmlns:a="attribute" xmlns:c="collection" xmlns:o="object">
<o:RootObject Id="o1"><c:Children><o:Model Id="o2"><a:Name>Billing</a:Name><a:Code>BILLING</a:Code>
<c:Tables>
<o:Table Id="o10"><a:Name>Invoice</a:Name><a:Code>BIL_INVOICE</a:Code><a:Comment>Invoices sent to customers</a:Comment>
<c:Columns>
<o:Column Id="o11"><a:Name>Invoice id</a:Name><a:Code>INVID</a:Code><a:DataType>INTEGER</a:DataType><a:Column.Mandatory>1</a:Column.Mandatory></o:Column>
<o:Column Id="o12"><a:Name>Due date</a:Name><a:Code>INVDUE_DATE</a:Code><a:Comment>Payment deadline</a:Comment><a:DataType>DATE</a:DataType><a:Column.Mandatory>1</a:Column.Mandatory></o:Column>
<o:Column Id="o13"><a:Name>Customer id</a:Name><a:Code>INVCUS_ID</a:Code><a:DataType>INTEGER</a:DataType></o:Column>
</c:Columns>
<c:Keys><o:Key Id="o14"><a:Name>Primary</a:Name><a:Code>PK_INVOICE</a:Code><a:ConstraintName>PAC_PK_INVOICE</a:ConstraintName><c:Key.Columns><o:Column Ref="o11"/></c:Key.Columns></o:Key></c:Keys>
<c:PrimaryKey><o:Key Ref="o14"/></c:PrimaryKey>
</o:Table>
<o:Table Id="o20"><a:Name>Customer</a:Name><a:Code>BIL_CUSTOMER</a:Code>
<c:Columns><o:Column Id="o21"><a:Name>Customer id</a:Name><a:Code>CUSID</a:Code><a:DataType>INTEGER</a:DataType></o:Column></c:Columns>
</o:Table>
</c:Tables>
<c:References>
<o:Reference Id="o30"><a:Name>Customer invoices</a:Name><a:Code>FK_INVOICE_CUSTOMER</a:Code><a:Cardinality>0..*</a:Cardinality>
<c:ParentTable><o:Table Ref="o20"/></c:ParentTable><c:ChildTable><o:Table Ref="o10"/></c:ChildTable>
<c:Joins><o:ReferenceJoin Id="o31"><c:Object1><o:Column Ref="o21"/></c:Object1><c:Object2><o:Column Ref="o13"/></c:Object2></o:ReferenceJoin></c:Joins>
</o:Reference>
</c:References>
<c:PhysicalDiagrams><o:PhysicalDiagram Id="o40"><a:Name>Main diagram</a:Name><c:Symbols><o:TableSymbol Id="o41"><a:Rect>((0,0), (1,1))</a:Rect></o:TableSymbol></c:Symbols></o:PhysicalDiagram></c:PhysicalDiagrams>
</o:Model></c:Children></o:RootObject></Model>`
}

/** A minimal Compound File Binary (version 3) Outlook message with one recipient and attachment. */
function outlookMessage(): Buffer {
  const unicode = (value: string) => Buffer.from(`${value}\0`, "utf16le")
  const properties = Buffer.alloc(32 + 16)
  properties.writeUInt32LE((0x0039 << 16) | 0x0040, 32)
  const filetime = BigInt(Date.UTC(2026, 2, 2, 9, 30) + 11_644_473_600_000) * 10_000n
  properties.writeBigUInt64LE(filetime, 40)
  const body = `The refund of 480 EUR is approved.${" Details follow.".repeat(300)}`
  return compoundFile([
    { name: "__substg1.0_0037001F", data: unicode("Refund approved") },
    { name: "__substg1.0_0C1A001F", data: unicode("Finance Desk") },
    { name: "__substg1.0_5D01001F", data: unicode("finance@example.com") },
    { name: "__substg1.0_0E04001F", data: unicode("Alex Martin") },
    // Larger than the 4096-byte mini stream cutoff, so it lives in regular sectors.
    { name: "__substg1.0_1000001F", data: unicode(body) },
    { name: "__properties_version1.0", data: properties },
    {
      name: "__attach_version1.0_#00000000",
      children: [{ name: "__substg1.0_3707001F", data: unicode("receipt.pdf") }],
    },
  ])
}

interface CompoundNode {
  name: string
  data?: Buffer
  children?: CompoundNode[]
}

function compoundFile(nodes: CompoundNode[]): Buffer {
  const SECTOR = 512
  const MINI = 64
  const END = 0xfffffffe
  const FREE = 0xffffffff
  interface Entry {
    name: string
    type: number
    data: Buffer
    child: number
    right: number
    start: number
  }
  const entries: Entry[] = [
    { name: "Root Entry", type: 5, data: Buffer.alloc(0), child: FREE, right: FREE, start: END },
  ]
  const add = (list: CompoundNode[], parent: number) => {
    let previous = -1
    for (const node of list) {
      const index = entries.length
      entries.push({
        name: node.name,
        type: node.children ? 1 : 2,
        data: node.data ?? Buffer.alloc(0),
        child: FREE,
        right: FREE,
        start: END,
      })
      if (previous < 0) {
        ;(entries[parent] as Entry).child = index
      } else {
        ;(entries[previous] as Entry).right = index
      }
      previous = index
      if (node.children) {
        add(node.children, index)
      }
    }
  }
  add(nodes, 0)

  const small = entries.filter((entry) => entry.type === 2 && entry.data.length < 4096)
  const large = entries.filter((entry) => entry.type === 2 && entry.data.length >= 4096)
  const miniFat: number[] = []
  const miniChunks: Buffer[] = []
  for (const entry of small) {
    if (entry.data.length === 0) {
      continue
    }
    const count = Math.ceil(entry.data.length / MINI)
    entry.start = miniFat.length
    for (let index = 0; index < count; index += 1) {
      miniFat.push(index === count - 1 ? END : miniFat.length + 1)
      miniChunks.push(entry.data.subarray(index * MINI, (index + 1) * MINI))
    }
  }
  const miniStream = Buffer.concat(
    miniChunks.map((chunk) => Buffer.concat([chunk, Buffer.alloc(MINI - chunk.length)])),
  )

  const sectorsFor = (bytes: number) => Math.ceil(bytes / SECTOR)
  const directorySectors = sectorsFor(entries.length * 128)
  const miniFatSectors = sectorsFor(miniFat.length * 4)
  const miniStreamSectors = sectorsFor(miniStream.length)
  const largeSectors = large.reduce((total, entry) => total + sectorsFor(entry.data.length), 0)
  const contentSectors = directorySectors + miniFatSectors + miniStreamSectors + largeSectors
  const fatSectors = Math.ceil((contentSectors + 1) / (SECTOR / 4 - 1))
  const fat: number[] = []
  const allocate = (count: number): number => {
    if (count === 0) {
      return END
    }
    const start = fat.length
    for (let index = 0; index < count; index += 1) {
      fat.push(index === count - 1 ? END : fat.length + 1)
    }
    return start
  }
  for (let index = 0; index < fatSectors; index += 1) {
    fat.push(0xfffffffd)
  }
  const directoryStart = allocate(directorySectors)
  const miniFatStart = allocate(miniFatSectors)
  const root = entries[0] as Entry
  root.start = allocate(miniStreamSectors)
  root.data = miniStream
  for (const entry of large) {
    entry.start = allocate(sectorsFor(entry.data.length))
  }
  const sectors = Buffer.alloc(fat.length * SECTOR)
  const writeAt = (start: number, data: Buffer) => {
    if (start !== END) {
      data.copy(sectors, start * SECTOR)
    }
  }
  const fatBytes = Buffer.alloc(fatSectors * SECTOR, 0xff)
  for (const [index, value] of fat.entries()) {
    fatBytes.writeUInt32LE(value, index * 4)
  }
  writeAt(0, fatBytes)
  const directory = Buffer.alloc(directorySectors * SECTOR)
  entries.forEach((entry, index) => {
    const offset = index * 128
    const name = Buffer.from(`${entry.name}\0`, "utf16le")
    name.copy(directory, offset)
    directory.writeUInt16LE(name.length, offset + 64)
    directory.writeUInt8(entry.type, offset + 66)
    directory.writeUInt8(1, offset + 67)
    directory.writeUInt32LE(FREE, offset + 68)
    directory.writeUInt32LE(entry.right, offset + 72)
    directory.writeUInt32LE(entry.child, offset + 76)
    directory.writeUInt32LE(entry.start, offset + 116)
    directory.writeUInt32LE(entry.data.length, offset + 120)
  })
  for (let index = entries.length; index < directorySectors * 4; index += 1) {
    directory.writeUInt32LE(FREE, index * 128 + 68)
    directory.writeUInt32LE(FREE, index * 128 + 72)
    directory.writeUInt32LE(FREE, index * 128 + 76)
  }
  writeAt(directoryStart, directory)
  const miniFatBytes = Buffer.alloc(miniFatSectors * SECTOR, 0xff)
  for (const [index, value] of miniFat.entries()) {
    miniFatBytes.writeUInt32LE(value, index * 4)
  }
  writeAt(miniFatStart, miniFatBytes)
  writeAt(root.start, miniStream)
  for (const entry of large) {
    writeAt(entry.start, entry.data)
  }

  const header = Buffer.alloc(SECTOR)
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header)
  header.writeUInt16LE(0x3e, 0x18)
  header.writeUInt16LE(3, 0x1a)
  header.writeUInt16LE(0xfffe, 0x1c)
  header.writeUInt16LE(9, 0x1e)
  header.writeUInt16LE(6, 0x20)
  header.writeUInt32LE(fatSectors, 0x2c)
  header.writeUInt32LE(directoryStart, 0x30)
  header.writeUInt32LE(4096, 0x38)
  header.writeUInt32LE(miniFatStart, 0x3c)
  header.writeUInt32LE(miniFatSectors, 0x40)
  header.writeUInt32LE(END, 0x44)
  for (let index = 0; index < 109; index += 1) {
    header.writeUInt32LE(index < fatSectors ? index : FREE, 0x4c + index * 4)
  }
  return Buffer.concat([header, sectors])
}
