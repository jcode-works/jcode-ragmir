import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { deflateRawSync, zstdCompressSync } from "node:zlib"
import { strToU8, zipSync } from "fflate"
import { afterEach, describe, expect, it } from "vitest"
import { inventorySourceFiles, listSourceFiles } from "./files.js"
import { ingest } from "./ingest.js"
import { initProject } from "./init.js"
import { parseFile } from "./parsing.js"
import { search } from "./query.js"
import { testConfig } from "./test-support/config.js"
import type { ParsedDocument, SourceFile } from "./types.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("mail and saved pages", () => {
  it("decodes an .eml message: encoded subject, quoted-printable body, and attachments", async () => {
    const parsed = await parseFixture(
      "renewal.eml",
      [
        "From: =?UTF-8?Q?Ana=C3=AFs_Martin?= <anais@example.com>",
        "To: legal@example.com",
        "Subject: =?UTF-8?B?UmVub3V2ZWxsZW1lbnQgZHUgY29udHJhdA==?=",
        "Date: Tue, 4 Nov 2025 09:30:00 +0100",
        "MIME-Version: 1.0",
        'Content-Type: multipart/mixed; boundary="outer"',
        "",
        "--outer",
        'Content-Type: multipart/alternative; boundary="inner"',
        "",
        "--inner",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "Le pr=C3=A9avis de r=C3=A9siliation passe =C3=A0 90 jours, avec une clause =",
        "de reconduction tacite.",
        "--inner",
        "Content-Type: text/html; charset=utf-8",
        "",
        "<p>HTML twin that must not be indexed twice</p>",
        "--inner--",
        "--outer",
        'Content-Type: application/pdf; name="avenant-2.pdf"',
        "Content-Transfer-Encoding: base64",
        'Content-Disposition: attachment; filename="avenant-2.pdf"',
        "",
        "JVBERi0xLjQKJcfsj6IK",
        "--outer--",
        "",
      ].join("\r\n"),
    )

    expect(parsed.sourceLineCoordinates).toBe(false)
    expect(parsed.text).toContain("Subject: Renouvellement du contrat")
    expect(parsed.text).toContain("From: Anaïs Martin <anais@example.com>")
    expect(parsed.text).toContain("Attachments: avenant-2.pdf")
    expect(parsed.text).toContain(
      "Le préavis de résiliation passe à 90 jours, avec une clause de reconduction tacite.",
    )
    expect(parsed.text).not.toContain("HTML twin")
    expect(parsed.text).not.toContain("JVBERi0")
  })

  it("renders the HTML alternative when a message has no plain text", async () => {
    const parsed = await parseFixture(
      "newsletter.eml",
      [
        "Subject: Release notes",
        'Content-Type: multipart/alternative; boundary="b"',
        "",
        "--b",
        "Content-Type: text/html; charset=windows-1252",
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from("<h1>Version 2</h1><p>Caf\xe9 mode is on.</p>", "latin1").toString("base64"),
        "--b--",
      ].join("\n"),
    )

    expect(parsed.text).toContain("VERSION 2")
    expect(parsed.text).toContain("Café mode is on.")
  })

  it("reads a forwarded message and the RFC 2231 file name of an attachment", async () => {
    const parsed = await parseFixture(
      "forward.eml",
      [
        "Subject: Fwd: incident",
        'Content-Type: multipart/mixed; boundary="m"',
        "",
        "--m",
        "Content-Type: text/plain",
        "",
        "See below.",
        "--m",
        "Content-Type: message/rfc822",
        "",
        "Subject: Checkout timeout",
        "From: oncall@example.com",
        "",
        "Retries were exhausted after 3 attempts.",
        "--m",
        "Content-Type: application/octet-stream",
        "Content-Disposition: attachment; filename*=utf-8''r%C3%A9sum%C3%A9.txt",
        "",
        "binary",
        "--m--",
      ].join("\n"),
    )

    expect(parsed.text).toContain("Forwarded message:\nSubject: Checkout timeout")
    expect(parsed.text).toContain("Retries were exhausted after 3 attempts.")
    expect(parsed.text).toContain("Attachments: résumé.txt")
  })

  it("reads the message inside an Apple Mail .emlx file", async () => {
    const message = "Subject: Board minutes\n\nThe board approved the budget.\n"
    const parsed = await parseFixture(
      "12345.emlx",
      `${Buffer.byteLength(message)}\n${message}<?xml version="1.0"?>\n<plist><dict/></plist>\n`,
    )

    expect(parsed.text).toContain("Subject: Board minutes")
    expect(parsed.text).toContain("The board approved the budget.")
    expect(parsed.text).not.toContain("plist")
  })

  it("cites each message of an .mbox mailbox as a section", async () => {
    const parsed = await parseFixture(
      "archive.mbox",
      [
        "From alice@example.com Mon Jan  6 09:00:00 2025",
        "Subject: Kickoff",
        "",
        "Kickoff agenda for the migration.",
        ">From the steering committee: approved.",
        "",
        "From bob@example.com Tue Jan  7 10:00:00 2025",
        "Subject: Re: Kickoff",
        "",
        "The rollback owner is Bob.",
        "",
      ].join("\n"),
    )

    expect(sectionLabels(parsed)).toEqual(["Message 1: Kickoff", "Message 2: Re: Kickoff"])
    expect(sectionText(parsed, "Message 1: Kickoff")).toContain(
      "From the steering committee: approved.",
    )
    expect(sectionText(parsed, "Message 2: Re: Kickoff")).toContain("The rollback owner is Bob.")
  })

  it("renders the page saved in an .mhtml archive", async () => {
    const parsed = await parseFixture(
      "runbook.mhtml",
      [
        "From: <Saved by Blink>",
        "Snapshot-Content-Location: https://wiki.example.com/runbook",
        "Subject: Incident runbook",
        'Content-Type: multipart/related; type="text/html"; boundary="----MultipartBoundary"',
        "",
        "------MultipartBoundary",
        "Content-Type: text/html",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "<html><body><h2>Escalation</h2><p>Page the on-call engineer after 15 minu=",
        "tes.</p></body></html>",
        "------MultipartBoundary",
        "Content-Type: image/png",
        "Content-Transfer-Encoding: base64",
        "",
        "iVBORw0KGgo=",
        "------MultipartBoundary--",
      ].join("\r\n"),
    )

    expect(parsed.text).toContain("Title: Incident runbook")
    expect(parsed.text).toContain("Address: https://wiki.example.com/runbook")
    expect(parsed.text).toContain("Page the on-call engineer after 15 minutes.")
    expect(parsed.text).not.toContain("iVBOR")
  })
})

describe("whiteboards and design files", () => {
  it("cites Excalidraw frames with labelled shapes and connections", async () => {
    const parsed = await parseFixture(
      "architecture.excalidraw",
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        elements: [
          { id: "f1", type: "frame", name: "Checkout", x: 0, y: 0 },
          { id: "api", type: "rectangle", frameId: "f1", x: 10, y: 10 },
          { id: "api-label", type: "text", containerId: "api", text: "Payments API", x: 12, y: 12 },
          { id: "db", type: "rectangle", frameId: "f1", x: 10, y: 200 },
          { id: "db-label", type: "text", containerId: "db", text: "Ledger DB", x: 12, y: 202 },
          {
            id: "arrow",
            type: "arrow",
            frameId: "f1",
            startBinding: { elementId: "api" },
            endBinding: { elementId: "db" },
          },
          { id: "arrow-label", type: "text", containerId: "arrow", text: "writes entries" },
          { id: "note", type: "text", text: "Retries are capped at 3", x: 500, y: 0 },
          { id: "gone", type: "text", text: "Deleted idea", isDeleted: true },
        ],
      }),
    )

    expect(sectionLabels(parsed)).toEqual(["Frame Checkout", "Canvas"])
    const frame = sectionText(parsed, "Frame Checkout")
    expect(frame).toContain("Frame: Checkout\nPayments API\nLedger DB")
    expect(frame).toContain("- Payments API -> Ledger DB: writes entries")
    expect(sectionText(parsed, "Canvas")).toContain("Retries are capped at 3")
    expect(parsed.text).not.toContain("Deleted idea")
  })

  it("cites tldraw pages with rich text, frames, and bound arrows", async () => {
    const parsed = await parseFixture(
      "flow.tldr",
      JSON.stringify({
        tldrawFileFormatVersion: 1,
        schema: { schemaVersion: 2, sequences: {} },
        records: [
          { id: "page:1", typeName: "page", name: "Onboarding", index: "a1" },
          {
            id: "shape:frame",
            typeName: "shape",
            type: "frame",
            parentId: "page:1",
            props: { name: "Signup" },
          },
          {
            id: "shape:a",
            typeName: "shape",
            type: "geo",
            parentId: "shape:frame",
            y: 0,
            props: {
              richText: {
                type: "doc",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Verify email" }] }],
              },
            },
          },
          {
            id: "shape:b",
            typeName: "shape",
            type: "note",
            parentId: "page:1",
            y: 100,
            props: { text: "Send welcome pack" },
          },
          { id: "shape:arrow", typeName: "shape", type: "arrow", parentId: "page:1", props: {} },
          {
            id: "binding:1",
            typeName: "binding",
            type: "arrow",
            fromId: "shape:arrow",
            toId: "shape:a",
            props: { terminal: "start" },
          },
          {
            id: "binding:2",
            typeName: "binding",
            type: "arrow",
            fromId: "shape:arrow",
            toId: "shape:b",
            props: { terminal: "end" },
          },
        ],
      }),
    )

    expect(sectionLabels(parsed)).toEqual(["Page Onboarding"])
    const page = sectionText(parsed, "Page Onboarding")
    expect(page).toContain("Frames:\n- Signup")
    expect(page).toContain("Verify email\nSend welcome pack")
    expect(page).toContain("- Verify email -> Send welcome pack")
  })

  it("cites JSON Canvas groups with their cards and edges", async () => {
    const parsed = await parseFixture(
      "research.canvas",
      JSON.stringify({
        nodes: [
          { id: "g", type: "group", label: "Sources", x: 0, y: 0, width: 500, height: 500 },
          {
            id: "t",
            type: "text",
            text: "# Pricing study\nChurn rises above 40 EUR",
            x: 10,
            y: 10,
            width: 200,
            height: 100,
          },
          {
            id: "f",
            type: "file",
            file: "notes/interviews.md",
            x: 10,
            y: 200,
            width: 200,
            height: 100,
          },
          {
            id: "l",
            type: "link",
            url: "https://example.com/report",
            x: 900,
            y: 0,
            width: 200,
            height: 100,
          },
        ],
        edges: [{ id: "e", fromNode: "t", toNode: "l", label: "evidence" }],
      }),
    )

    expect(sectionLabels(parsed)).toEqual(["Group Sources", "Canvas"])
    const group = sectionText(parsed, "Group Sources")
    expect(group).toContain("Churn rises above 40 EUR")
    expect(group).toContain("File: notes/interviews.md")
    expect(group).toContain("- # Pricing study -> Link: https://example.com/report: evidence")
    expect(sectionText(parsed, "Canvas")).toContain("Link: https://example.com/report")
  })

  it("cites Sketch artboards with text layers and symbol overrides", async () => {
    const page = {
      _class: "page",
      name: "Mobile",
      layers: [
        {
          _class: "artboard",
          name: "Login",
          layers: [
            {
              _class: "text",
              name: "title",
              frame: { x: 0, y: 0 },
              attributedString: { string: "Welcome back" },
            },
            {
              _class: "symbolInstance",
              name: "Button",
              frame: { x: 0, y: 300 },
              overrideValues: [{ overrideName: "abc_stringValue", value: "Sign in with SSO" }],
            },
          ],
        },
        { _class: "text", name: "loose", attributedString: { string: "Draft copy" } },
      ],
    }
    const parsed = await parseFixture(
      "app.sketch",
      Buffer.from(
        zipSync({
          "document.json": strToU8("{}"),
          "pages/ABC.json": strToU8(JSON.stringify(page)),
          "previews/preview.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        }),
      ),
    )

    expect(sectionLabels(parsed)).toEqual(["Artboard Mobile / Login", "Page Mobile"])
    expect(sectionText(parsed, "Artboard Mobile / Login")).toContain(
      "Welcome back\nSign in with SSO",
    )
    expect(sectionText(parsed, "Page Mobile")).toContain("Draft copy")
  })

  it("cites each XMind sheet with its outline, notes, markers, and relationships", async () => {
    const sheets = [
      {
        id: "sheet-1",
        class: "sheet",
        title: "Launch plan",
        rootTopic: {
          id: "root",
          title: "Checkout launch",
          children: {
            attached: [
              {
                id: "risks",
                title: "Risks",
                labels: ["blocking"],
                markers: [{ markerId: "priority-1" }, { markerId: "smiley-laugh" }],
                notes: { plain: { content: "Card fraud rules\nneed review" } },
                children: {
                  attached: [
                    { id: "fraud", title: "Fraud rules", href: "https://example.test/fraud" },
                  ],
                },
              },
              { id: "ship", title: "Ship", markers: [{ markerId: "task-done" }], href: "xmind:#a" },
            ],
            detached: [{ id: "idea", title: "Gift cards later" }],
            summary: [{ id: "summary", title: "Two workstreams" }],
          },
        },
        relationships: [{ id: "link", end1Id: "fraud", end2Id: "ship", title: "blocks" }],
      },
      { id: "sheet-2", class: "sheet", title: "Retro", rootTopic: { id: "r", title: "Keep" } },
    ]
    const parsed = await parseFixture(
      "launch.xmind",
      Buffer.from(
        zipSync({
          "content.json": strToU8(JSON.stringify(sheets)),
          // XMind 2020 also writes a stub content.xml for older versions; content.json wins.
          "content.xml": strToU8(
            "<xmap-content><sheet><topic><title>Old stub</title></topic></sheet></xmap-content>",
          ),
          "metadata.json": strToU8("{}"),
          "Thumbnails/thumbnail.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        }),
      ),
    )

    expect(sectionLabels(parsed)).toEqual(["Sheet Launch plan", "Sheet Retro"])
    expect(sectionText(parsed, "Sheet Launch plan")).toBe(
      [
        "Mind map: Launch plan",
        "- Checkout launch",
        "  - Risks",
        "    Labels: blocking",
        "    Markers: priority-1",
        "    Note: Card fraud rules",
        "      need review",
        "    - Fraud rules",
        "      Link: https://example.test/fraud",
        "  - Ship",
        "    Markers: task-done",
        "  - Floating topic: Gift cards later",
        "  - Summary: Two workstreams",
        "Relationships:",
        "- Fraud rules -> Ship: blocks",
      ].join("\n"),
    )
    expect(sectionText(parsed, "Sheet Retro")).toBe("Mind map: Retro\n- Keep")
    expect(parsed.text).not.toContain("Old stub")
  })

  it("reads XMind 8 maps and reports unreadable ones", async () => {
    const legacy = await parseFixture(
      "roadmap.xmind",
      Buffer.from(
        zipSync({
          "content.xml": strToU8(
            [
              '<?xml version="1.0" encoding="UTF-8"?>',
              '<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0" xmlns:xlink="http://www.w3.org/1999/xlink">',
              '<sheet id="s1"><topic id="t1"><title>Roadmap</title><children><topics type="attached">',
              '<topic id="t2" xlink:href="https://example.test/q3"><title>Q3</title>',
              "<notes><plain>Ship invoices\nthen refunds</plain></notes>",
              "<labels><label>finance</label></labels>",
              '<marker-refs><marker-ref marker-id="task-half"/></marker-refs></topic>',
              '<topic id="t3"><title>Q4</title></topic>',
              "</topics></children></topic><title>Plan</title>",
              '<relationships><relationship end1="t2" end2="t3"><title>before</title></relationship></relationships>',
              "</sheet></xmap-content>",
            ].join(""),
          ),
        }),
      ),
    )

    expect(sectionLabels(legacy)).toEqual(["Sheet Plan"])
    expect(sectionText(legacy, "Sheet Plan")).toBe(
      [
        "Mind map: Plan",
        "- Roadmap",
        "  - Q3",
        "    Labels: finance",
        "    Markers: task-half",
        "    Link: https://example.test/q3",
        "    Note: Ship invoices",
        "      then refunds",
        "  - Q4",
        "Relationships:",
        "- Q3 -> Q4: before",
      ].join("\n"),
    )

    await expect(
      parseFixture(
        "locked.xmind",
        Buffer.from(zipSync({ "content.json": new Uint8Array([0x00, 0x9f, 0x92, 0x96]) })),
      ),
    ).rejects.toThrow("Save a copy without a password")
    await expect(
      parseFixture("empty.xmind", Buffer.from(zipSync({ "metadata.json": strToU8("{}") }))),
    ).rejects.toThrow("XMind file has no content.json or content.xml.")
  })

  it("cites Figma frames and component descriptions from a REST export", async () => {
    const parsed = await parseFixture(
      "design-system.json",
      JSON.stringify({
        name: "Design system",
        document: {
          id: "0:0",
          type: "DOCUMENT",
          children: [
            {
              id: "0:1",
              type: "CANVAS",
              name: "Checkout",
              children: [
                {
                  id: "1:1",
                  type: "FRAME",
                  name: "Payment",
                  children: [
                    { id: "1:2", type: "TEXT", name: "Title", characters: "Pay securely" },
                    { id: "1:3", type: "INSTANCE", name: "Primary button", children: [] },
                    { id: "1:4", type: "TEXT", characters: "Hidden", visible: false },
                  ],
                },
                { id: "1:9", type: "STICKY", characters: "Ask legal about refunds" },
              ],
            },
          ],
        },
        components: { "1:3": { name: "Primary button", description: "Use for the main action" } },
      }),
    )

    expect(sectionLabels(parsed)).toEqual(["Frame Checkout / Payment", "Page Checkout"])
    const frame = sectionText(parsed, "Frame Checkout / Payment")
    expect(frame).toContain("Pay securely")
    expect(frame).toContain("Primary button: Use for the main action")
    expect(frame).not.toContain("Hidden")
    expect(sectionText(parsed, "Page Checkout")).toContain("Ask legal about refunds")
  })
})

describe("Figma files", () => {
  it("cites frames, text, instance overrides, and component descriptions of a .fig file", async () => {
    const parsed = await parseFixture("checkout.fig", figmaFile(deflateRawSync))

    expect(sectionLabels(parsed)).toEqual([
      "Frame Checkout / Payment",
      "Component Checkout / Primary button",
      "Page Checkout",
    ])
    const frame = sectionText(parsed, "Frame Checkout / Payment")
    expect(frame).toContain("Pay securely")
    expect(frame).toContain("Pay 49 EUR now")
    expect(frame).toContain("Pay button: Use for the main action")
    expect(frame).not.toContain("Hidden draft")
    expect(sectionText(parsed, "Page Checkout")).toContain("Ask legal about refunds")
    expect(parsed.text).not.toContain("Deleted layer")
    expect(parsed.text).not.toContain("Internal Only Canvas")
  })

  it.runIf(typeof zstdCompressSync === "function")(
    "reads .fig documents compressed with Zstandard",
    async () => {
      const parsed = await parseFixture("checkout-zstd.fig", figmaFile(zstdCompressSync))

      expect(sectionText(parsed, "Frame Checkout / Payment")).toContain("Pay securely")
    },
  )

  it("reports a .fig file that is not a Figma design", async () => {
    await expect(parseFixture("plot.fig", "#FIG 3.2\nLandscape\n")).rejects.toThrow(
      "Not a Figma design file",
    )
  })
})

describe("API collections and data exports", () => {
  it("cites each Postman request and leaves secret values out", async () => {
    const parsed = await parseFixture(
      "billing.postman_collection.json",
      JSON.stringify({
        info: {
          name: "Billing API",
          schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [
          {
            name: "Invoices",
            description: "Invoice endpoints",
            item: [
              {
                name: "Get invoice",
                request: {
                  method: "GET",
                  header: [
                    { key: "Accept", value: "application/json" },
                    { key: "Authorization", value: "Bearer super-secret-token" },
                  ],
                  url: {
                    raw: "{{baseUrl}}/invoices/:id?expand=lines",
                    variable: [{ key: "id", value: "", description: "Invoice identifier" }],
                  },
                  description: "Returns one invoice with its lines.",
                },
                response: [{ name: "Paid invoice", code: 200, body: '{"status":"paid"}' }],
              },
            ],
          },
        ],
      }),
    )

    expect(sectionLabels(parsed)).toEqual([
      "Collection Billing API",
      "Folder Invoices",
      "GET {{baseUrl}}/invoices/:id",
    ])
    const request = sectionText(parsed, "GET {{baseUrl}}/invoices/:id")
    expect(request).toContain("Request: Invoices / Get invoice")
    expect(request).toContain("Description: Returns one invoice with its lines.")
    expect(request).toContain("- id (Invoice identifier)")
    expect(request).toContain("- Authorization: (value omitted)")
    expect(request).toContain('Example response: Paid invoice (200)\n{"status":"paid"}')
    expect(parsed.text).not.toContain("super-secret-token")
  })

  it("cites HTTP Archive requests and leaves cookies, credentials, and assets out", async () => {
    const status = {
      _resourceType: "xhr",
      request: { method: "GET", url: "https://api.example.com/v1/orders/ord_42/status" },
      response: {
        status: 200,
        content: { mimeType: "application/json", text: '{"state":"paid"}' },
      },
    }
    const parsed = await parseFixture(
      "checkout.har",
      JSON.stringify({
        log: {
          version: "1.2",
          creator: { name: "WebInspector", version: "537.36" },
          browser: { name: "Chrome", version: "131" },
          pages: [
            { id: "page_1", title: "https://shop.example.com/checkout?sid=page-secret#step2" },
          ],
          entries: [
            {
              pageref: "page_1",
              _resourceType: "fetch",
              request: {
                method: "post",
                url: "https://user:url-password@api.example.com/v1/orders?expand=lines&access_token=query-token-123",
                headers: [
                  { name: ":authority", value: "api.example.com" },
                  { name: "Content-Type", value: "application/json" },
                  { name: "Authorization", value: "Bearer header-token-456" },
                  { name: "Cookie", value: "sid=cookie-value-789" },
                  { name: "X-Request-Id", value: "req-42" },
                  { name: "sec-fetch-mode", value: "cors" },
                ],
                cookies: [{ name: "sid", value: "cookie-value-789" }],
                postData: {
                  mimeType: "application/json",
                  text: JSON.stringify({
                    sku: "TEA-01",
                    quantity: 2,
                    password: "hunter2",
                    note: "Bearer note-token-000",
                  }),
                },
              },
              response: {
                status: 201,
                statusText: "Created",
                headers: [
                  { name: "Set-Cookie", value: "sid=new-cookie-111; HttpOnly" },
                  { name: "Location", value: "/v1/orders/ord_42" },
                ],
                content: {
                  mimeType: "application/json; charset=utf-8",
                  text: JSON.stringify({
                    id: "ord_42",
                    status: "pending_payment",
                    refresh_token: "refresh-222",
                    customer: { email: "ada@example.com" },
                    receipt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl",
                  }),
                },
              },
            },
            status,
            status,
            {
              request: { method: "GET", url: "https://api.example.com/v1/catalog" },
              response: {
                status: 200,
                content: {
                  mimeType: "application/json",
                  encoding: "base64",
                  text: Buffer.from('{"items":["green tea"]}').toString("base64"),
                },
              },
            },
            {
              _resourceType: "image",
              request: { method: "GET", url: "https://cdn.example.com/logo.png" },
              response: { status: 200, content: { mimeType: "image/png", encoding: "base64" } },
            },
            {
              request: { method: "OPTIONS", url: "https://api.example.com/v1/orders" },
              response: { status: 204, content: {} },
            },
            {
              request: { method: "GET", url: "data:image/png;base64,AAAA" },
              response: { status: 200, content: { mimeType: "image/png" } },
            },
            {
              _resourceType: "document",
              request: { method: "GET", url: "https://shop.example.com/help/returns" },
              response: {
                status: 200,
                content: {
                  mimeType: "text/html",
                  text: "<html><body><p>Returns are accepted within 30 days.</p></body></html>",
                },
              },
            },
            {
              _resourceType: "document",
              request: {
                method: "GET",
                url: "https://shop.example.com/oauth/callback?code=auth-code-333&state=st-444&lang=fr",
              },
              response: { status: 302, content: { mimeType: "text/html", text: "" } },
            },
            {
              _resourceType: "fetch",
              request: {
                method: "POST",
                url: "https://shop.example.com/login",
                postData: {
                  mimeType: "application/x-www-form-urlencoded",
                  text: "username=ada&password=hunter3",
                },
              },
              response: { status: 200, content: { mimeType: "text/plain", text: "Welcome back" } },
            },
          ],
        },
      }),
    )

    expect(sectionLabels(parsed)).toEqual([
      "HTTP Archive",
      "POST https://api.example.com/v1/orders",
      "GET https://api.example.com/v1/orders/ord_42/status",
      "GET https://api.example.com/v1/catalog",
      "GET https://shop.example.com/help/returns",
      "GET https://shop.example.com/oauth/callback",
      "POST https://shop.example.com/login",
    ])
    const overview = sectionText(parsed, "HTTP Archive")
    expect(overview).toContain("HTTP Archive recorded with WebInspector 537.36 in Chrome 131")
    expect(overview).toContain("Pages:\n- https://shop.example.com/checkout")
    expect(overview).toContain(
      "Requests: 10, 6 indexed, 3 static assets, preflights, or non-HTTP requests skipped",
    )

    const order = sectionText(parsed, "POST https://api.example.com/v1/orders")
    expect(order).toContain("Status: 201 Created")
    expect(order).toContain("Query parameters:\n- expand: lines\n- access_token: (value omitted)")
    expect(order).toContain("- Authorization: (value omitted)")
    expect(order).toContain("- Cookie: (value omitted)")
    expect(order).toContain("- X-Request-Id: req-42")
    expect(order).toContain('"sku": "TEA-01"')
    expect(order).toContain('"password": "(value omitted)"')
    expect(order).toContain('"note": "(value omitted)"')
    expect(order).toContain("- Set-Cookie: (value omitted)")
    expect(order).toContain("Response body (application/json):")
    expect(order).toContain('"status": "pending_payment"')
    expect(order).toContain('"refresh_token": "(value omitted)"')
    expect(order).toContain('"email": "ada@example.com"')
    expect(order).toContain('"receipt": "(value omitted)"')

    const polling = sectionText(parsed, "GET https://api.example.com/v1/orders/ord_42/status")
    expect(polling).toContain('"state": "paid"')
    expect(polling).toContain("Repeated 2 times")
    expect(sectionText(parsed, "GET https://api.example.com/v1/catalog")).toContain(
      '"items": [\n    "green tea"\n  ]',
    )
    expect(sectionText(parsed, "GET https://shop.example.com/help/returns")).toContain(
      "Returns are accepted within 30 days.",
    )
    expect(sectionText(parsed, "GET https://shop.example.com/oauth/callback")).toContain(
      "- code: (value omitted)\n- state: (value omitted)\n- lang: fr",
    )
    expect(sectionText(parsed, "POST https://shop.example.com/login")).toContain(
      "username=ada\npassword=(value omitted)",
    )

    for (const secret of [
      "url-password",
      "query-token-123",
      "header-token-456",
      "cookie-value-789",
      "hunter2",
      "note-token-000",
      "new-cookie-111",
      "refresh-222",
      "eyJhbGciOiJIUzI1NiJ9",
      "page-secret",
      "auth-code-333",
      "st-444",
      "hunter3",
      ":authority",
      "sec-fetch-mode",
      "logo.png",
    ]) {
      expect(parsed.text).not.toContain(secret)
    }
  })

  it("indexes dotenv templates with every value masked and their lines in place", async () => {
    const template = [
      "# Payment provider",
      "# Old key pk_51Hx0aBcDeFgHiJkLmNoPq was rotated",
      "STRIPE_SECRET_KEY=rk_4eC39HqLyjWDarjtT1zdp7dc",
      "export PORT=3000 # local port",
      "DATABASE_URL='postgres://app:hunter2@db:5432/app'",
      "EMPTY_DEFAULT=",
      'SIGNING_KEY="first line of a multi-line value',
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ",
      'last line of the value"',
      "",
      "FEATURE_FLAGS=checkout,refunds",
      "not an assignment with secret-value-7f3a9b2c4d5e6f",
    ].join("\n")
    const parsed = await parseFixture(".env.example", template)

    expect(parsed.text.split("\n")).toEqual([
      "# Payment provider",
      "# Old key (value omitted) was rotated",
      "STRIPE_SECRET_KEY=(value omitted)",
      "export PORT=(value omitted) # local port",
      "DATABASE_URL=(value omitted)",
      "EMPTY_DEFAULT=",
      "SIGNING_KEY=(value omitted)",
      "",
      "",
      "",
      "FEATURE_FLAGS=(value omitted)",
    ])
    expect(parsed.sourceLineCoordinates).toBe(true)
    for (const secret of [
      "pk_51Hx0",
      "rk_4eC39",
      "hunter2",
      "multi-line value",
      "MIIEvQIBADAN",
      "3000",
      "refunds",
    ]) {
      expect(parsed.text).not.toContain(secret)
    }
    expect((await parseFixture("env.sample", "API_TOKEN=abc123\n")).text).toBe(
      "API_TOKEN=(value omitted)",
    )
  })

  it("refuses a .har file that is not an HTTP Archive", async () => {
    await expect(
      parseFixture("notes.har", JSON.stringify({ entries: [{ cookie: "sid=raw" }] })),
    ).rejects.toThrow("Not an HTTP Archive")
  })

  it("cites Insomnia v4 requests under their folders", async () => {
    const parsed = await parseFixture(
      "insomnia.json",
      JSON.stringify({
        _type: "export",
        __export_format: 4,
        resources: [
          { _id: "wrk", _type: "workspace", name: "Shop" },
          { _id: "fld", _type: "request_group", parentId: "wrk", name: "Orders" },
          {
            _id: "req",
            _type: "request",
            parentId: "fld",
            name: "Cancel order",
            method: "post",
            url: "{{ base }}/orders/42/cancel",
            body: { mimeType: "application/json", text: '{"reason":"duplicate"}' },
          },
          { _id: "env", _type: "environment", data: { token: "never indexed" } },
        ],
      }),
    )

    expect(sectionLabels(parsed)).toEqual(["Collection Shop", "POST {{ base }}/orders/42/cancel"])
    expect(sectionText(parsed, "POST {{ base }}/orders/42/cancel")).toContain(
      "Request: Orders / Cancel order",
    )
    expect(parsed.text).not.toContain("never indexed")
  })

  it("cites GeoJSON features by name with their properties", async () => {
    const parsed = await parseFixture(
      "sites.geojson",
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "Lyon depot", capacity: 120, opens: "06:00" },
            geometry: { type: "Point", coordinates: [4.85, 45.75] },
          },
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 0],
                ],
              ],
            },
          },
        ],
      }),
    )

    expect(sectionLabels(parsed)).toEqual(["Feature Lyon depot", "Feature Feature 2"])
    expect(sectionText(parsed, "Feature Lyon depot")).toContain(
      "Geometry: Point (4.85, 45.75)\nname: Lyon depot\ncapacity: 120",
    )
    expect(parsed.text).not.toContain("[[")
  })

  it("cites SARIF findings with their rule and location", async () => {
    const parsed = await parseFixture(
      "scan.sarif",
      JSON.stringify({
        version: "2.1.0",
        runs: [
          {
            tool: {
              driver: {
                name: "CodeQL",
                rules: [
                  {
                    id: "js/sql-injection",
                    name: "SqlInjection",
                    shortDescription: { text: "Database query built from user-controlled sources" },
                  },
                ],
              },
            },
            results: [
              {
                ruleId: "js/sql-injection",
                level: "error",
                message: { text: "This query depends on a user-provided value." },
                locations: [
                  {
                    physicalLocation: {
                      artifactLocation: { uri: "src/orders.ts" },
                      region: { startLine: 42 },
                    },
                  },
                ],
              },
            ],
          },
        ],
      }),
    )

    expect(sectionLabels(parsed)).toEqual(["js/sql-injection src/orders.ts:42"])
    const finding = sectionText(parsed, "js/sql-injection src/orders.ts:42")
    expect(finding).toContain("Tool: CodeQL")
    expect(finding).toContain("Level: error")
    expect(finding).toContain("Database query built from user-controlled sources")
  })

  it("keeps ordinary JSON as plain text", async () => {
    const parsed = await parseFixture("settings.json", JSON.stringify({ retries: 3 }))

    expect(parsed.regions).toBeUndefined()
    expect(parsed.text).toContain('"retries": 3')
  })
})

describe("notes and books", () => {
  it("cites Evernote notes with tags, source, and rendered body", async () => {
    const parsed = await parseFixture(
      "export.enex",
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export application="Evernote">
  <note>
    <title>Supplier call</title>
    <created>20250114T091500Z</created>
    <tag>suppliers</tag><tag>q1</tag>
    <note-attributes><source-url>https://crm.example.com/acme</source-url></note-attributes>
    <content><![CDATA[<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><div>Acme accepts net 45 payment terms.</div></en-note>]]></content>
    <resource><data encoding="base64">iVBORw0KGgo=</data><resource-attributes><file-name>quote.png</file-name></resource-attributes></resource>
  </note>
</en-export>`,
    )

    expect(sectionLabels(parsed)).toEqual(["Note Supplier call"])
    const note = sectionText(parsed, "Note Supplier call")
    expect(note).toContain("Tags: suppliers, q1")
    expect(note).toContain("Created: 2025-01-14 09:15 UTC")
    expect(note).toContain("Source: https://crm.example.com/acme")
    expect(note).toContain("Attachments: quote.png")
    expect(note).toContain("Acme accepts net 45 payment terms.")
    expect(parsed.text).not.toContain("iVBOR")
  })

  it("cites FictionBook chapters after the book description", async () => {
    const parsed = await parseFixture(
      "novel.fb2",
      `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description><title-info>
    <author><first-name>Ada</first-name><last-name>Byron</last-name></author>
    <book-title>Engines</book-title>
    <annotation><p>A story about computing machines.</p></annotation>
  </title-info></description>
  <body>
    <section><title><p>The Mill</p></title><p>The mill weaves numbers.</p></section>
    <section><title><p>The Store</p></title><p>The store keeps results.</p></section>
  </body>
  <binary id="cover.jpg" content-type="image/jpeg">/9j/4AAQ</binary>
</FictionBook>`,
    )

    expect(sectionLabels(parsed)).toEqual(["Book Engines", "Chapter The Mill", "Chapter The Store"])
    expect(sectionText(parsed, "Book Engines")).toContain("Authors: Ada Byron")
    expect(sectionText(parsed, "Chapter The Store")).toContain("The store keeps results.")
    expect(parsed.text).not.toContain("/9j/")
  })
})

describe("Office and OpenDocument variants", () => {
  it("reads macro-enabled Word documents like .docx", async () => {
    const parsed = await parseFixture(
      "approval.docm",
      Buffer.from(
        zipSync({
          "[Content_Types].xml": strToU8(
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>',
          ),
          "_rels/.rels": strToU8(
            '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
          ),
          "word/document.xml": strToU8(
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Macro approval workflow</w:t></w:r></w:p></w:body></w:document>',
          ),
          "word/vbaProject.bin": new Uint8Array([0, 1, 2, 3]),
        }),
      ),
    )

    expect(parsed.text).toContain("Macro approval workflow")
  })

  it("reads macro-enabled workbooks and slide shows with sheet and slide citations", async () => {
    const workbook = await parseFixture(
      "forecast.xlsm",
      Buffer.from(
        zipSync({
          "[Content_Types].xml": strToU8(
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
          ),
          "_rels/.rels": strToU8(
            '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
          ),
          "xl/workbook.xml": strToU8(
            '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Forecast" sheetId="1" r:id="rId1"/></sheets></workbook>',
          ),
          "xl/_rels/workbook.xml.rels": strToU8(
            '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
          ),
          "xl/worksheets/sheet1.xml": strToU8(
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Q3 bookings</t></is></c><c r="B1"><v>1200</v></c></row></sheetData></worksheet>',
          ),
        }),
      ),
    )
    const slides = await parseFixture(
      "keynote.ppsx",
      Buffer.from(
        zipSync({
          "ppt/slides/slide1.xml": strToU8(
            '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Launch timeline</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
          ),
        }),
      ),
    )

    expect(workbook.text).toContain("Q3 bookings\t1200")
    expect(workbook.regions?.[0]?.location.kind).toBe("sheet")
    expect(slides.text).toContain("Launch timeline")
    expect(slides.regions?.[0]?.location.kind).toBe("slide")
  })

  it("reads flat OpenDocument text without its styles and settings", async () => {
    const parsed = await parseFixture(
      "policy.fodt",
      `<?xml version="1.0"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <office:meta><dc:title>Travel policy</dc:title></office:meta>
  <office:settings><config:config-item>VisibleAreaTop 1234</config:config-item></office:settings>
  <office:styles><style:style style:name="Heading"/></office:styles>
  <office:body><office:text><text:h>Hotels</text:h><text:p>Book hotels under 150 EUR per night.</text:p></office:text></office:body>
</office:document>`,
    )

    expect(parsed.text).toContain("Travel policy")
    expect(parsed.text).toContain("Book hotels under 150 EUR per night.")
    expect(parsed.text).not.toContain("VisibleAreaTop")
  })
})

describe("text formats and encodings", () => {
  it("indexes extensionless project files and build file variants", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-names-"))
    tempDirs.push(root)
    await writeFile(path.join(root, "README"), "Project overview\n")
    await writeFile(path.join(root, "Dockerfile.prod"), "FROM node:22-slim\n")
    await writeFile(path.join(root, "Jenkinsfile"), "pipeline { }\n")
    await writeFile(path.join(root, "main.zig"), "pub fn main() void {}\n")
    await writeFile(path.join(root, "messages.po"), 'msgid "Save"\nmsgstr "Enregistrer"\n')
    await writeFile(path.join(root, "photo.raw"), "not text")

    const files = await listSourceFiles(testConfig(root, { rawDir: root }))

    expect(files.map((file) => file.relativePath).sort()).toEqual([
      "Dockerfile.prod",
      "Jenkinsfile",
      "README",
      "main.zig",
      "messages.po",
    ])
  })

  it("indexes .NET projects, Godot scenes, modern languages, and build manifests", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-linguist-"))
    tempDirs.push(root)
    const sources: Record<string, string> = {
      "App.csproj": '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup /></Project>\n',
      "App.sln": "Microsoft Visual Studio Solution File, Format Version 12.00\n",
      "Directory.Build.props": "<Project><PropertyGroup /></Project>\n",
      "player.gd": "extends CharacterBody2D\n",
      "level.tscn": '[gd_scene format=3]\n[node name="Level" type="Node2D"]\n',
      "Game.luau": "local speed: number = 16\n",
      "Proof.lean": "theorem two_eq : 2 = 2 := rfl\n",
      "page.templ": "templ Hello(name string) { <p>{ name }</p> }\n",
      "config.kdl": 'service "checkout" { retries 3 }\n',
      "go.mod": "module example.com/checkout\n\ngo 1.24\n",
      "meson.build": "project('checkout', 'c')\n",
      PKGBUILD: "pkgname=checkout\n",
      ".rspec": "--require spec_helper\n",
      "strings.res": "not text",
    }
    for (const [name, content] of Object.entries(sources)) {
      await writeFile(path.join(root, name), content)
    }

    const files = await listSourceFiles(testConfig(root, { rawDir: root }))
    const listed = files.map((file) => file.relativePath).sort()

    // A binary Windows resource shares `.res` with ReScript, so it stays out.
    expect(listed).toEqual(
      Object.keys(sources)
        .filter((name) => name !== "strings.res")
        .sort(),
    )
    const godot = await parseFixture("level.tscn", sources["level.tscn"] ?? "")
    expect(godot.sourceLineCoordinates).toBe(true)
    expect(godot.text).toContain('[node name="Level" type="Node2D"]')
  })

  it("indexes C++ modules, Perl modules, Gherkin features, and other common file types", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-linguist-more-"))
    tempDirs.push(root)
    const sources: Record<string, string> = {
      "math.cppm": "export module math;\nexport int add(int a, int b) { return a + b; }\n",
      "vector.inl": "template <typename T> T Vector<T>::length() const { return size; }\n",
      "Checkout.pm": "package Checkout;\nsub total { return 42 }\n1;\n",
      "checkout.t": "use Test::More;\nok(1);\ndone_testing;\n",
      "checkout.feature": "Feature: Checkout\n  Scenario: Pay by card\n    Given a cart\n",
      "smoke.robot": "*** Test Cases ***\nOpen Checkout\n    Log    ready\n",
      "invoice.heex": "<p>Total: <%= @total %></p>\n",
      "invoice.xslt": '<xsl:stylesheet version="1.0" />\n',
      "engine.vcxproj": '<Project DefaultTargets="Build" />\n',
      "App.slnx": '<Solution><Project Path="App/App.csproj" /></Solution>\n',
      "schema.graphqls": "type Invoice { id: ID! }\n",
      "build.zig.zon": '.{ .name = .checkout, .version = "0.1.0" }\n',
      "main.nf": "workflow { CHECKOUT() }\n",
      "pricing.cds": "entity Invoices { key ID : UUID; }\n",
      "rules.yar": "rule Invoice { condition: true }\n",
      "checkout.container": "[Container]\nImage=registry.example.test/checkout\n",
      "Info.plist":
        "<plist><dict><key>CFBundleName</key><string>Checkout</string></dict></plist>\n",
      "CITATION.cff": "cff-version: 1.2.0\ntitle: Checkout\n",
      NEWS: "Version 2.0: card payments\n",
      ".clangd": "CompileFlags:\n  Add: [-std=c++20]\n",
      "Report.xlsb": "binary workbook",
    }
    for (const [name, content] of Object.entries(sources)) {
      await writeFile(path.join(root, name), content)
    }

    const inventory = await inventorySourceFiles(testConfig(root, { rawDir: root }))

    expect(inventory.supportedFiles.map((file) => file.relativePath).sort()).toEqual(
      Object.keys(sources)
        .filter((name) => name !== "Report.xlsb")
        .sort(),
    )
    expect(inventory.skippedFiles).toEqual([
      expect.objectContaining({
        relativePath: "Report.xlsb",
        reason: "unsupported-extension",
        recommendation: "Save the binary Excel workbook as XLSX or CSV before ingesting.",
      }),
    ])
    const feature = await parseFixture("checkout.feature", sources["checkout.feature"] ?? "")
    expect(feature.sourceLineCoordinates).toBe(true)
    expect(feature.text).toContain("  Scenario: Pay by card")
  })

  it("reads XML property lists with line citations and reports binary ones", async () => {
    const xml = await parseFixture(
      "Info.plist",
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<plist version="1.0">',
        "<dict>",
        "  <key>CFBundleDisplayName</key>",
        "  <string>Checkout</string>",
        "</dict>",
        "</plist>",
        "",
      ].join("\n"),
    )
    expect(xml.sourceLineCoordinates).toBe(true)
    expect(xml.text.split("\n")[4]).toBe("  <string>Checkout</string>")

    await expect(
      parseFixture(
        "Preferences.plist",
        Buffer.concat([Buffer.from("bplist00", "latin1"), Buffer.from([0xd1, 0x01, 0x02])]),
      ),
    ).rejects.toThrow("plutil -convert xml1")
  })

  it("reads UTF-16 and Windows-1252 text files with line citations", async () => {
    const utf16 = await parseFixture(
      "Localizable.strings",
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from('"checkout.title" = "Paiement sécurisé";\n', "utf16le"),
      ]),
    )
    const legacy = await parseFixture(
      "subtitles.srt",
      Buffer.from("1\n00:00:01,000 --> 00:00:02,000\nCafé ouvert à 8 h\n", "latin1"),
    )

    expect(utf16.sourceLineCoordinates).toBe(true)
    expect(utf16.text).toContain('"checkout.title" = "Paiement sécurisé";')
    expect(legacy.text).toContain("Café ouvert à 8 h")
  })

  it("cites a new structured format end to end", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-formats-ingest-"))
    tempDirs.push(root)
    await initProject(root)
    const raw = path.join(root, ".ragmir", "raw")
    await mkdir(raw, { recursive: true })
    await writeFile(
      path.join(raw, "team.mbox"),
      [
        "From a@example.com Mon Jan  6 09:00:00 2025",
        "Subject: Vendor shortlist",
        "",
        "Shortlist Globex and Initech for the warehouse scanners.",
        "",
        "From b@example.com Tue Jan  7 10:00:00 2025",
        "Subject: Parking",
        "",
        "Visitor parking moves to level two.",
        "",
      ].join("\n"),
    )

    const result = await ingest({ cwd: root })
    expect(result.errors).toEqual([])
    const hits = await search("warehouse scanners vendor shortlist", { cwd: root, topK: 3 })

    expect(hits[0]?.citation).toMatch(
      /^\.ragmir\/raw\/team\.mbox:section=Message%201%3A%20Vendor%20shortlist#\d+$/u,
    )
  })
})

/** A minimal Figma `.fig` file: a ZIP holding a Kiwi schema and one document message. */
function figmaFile(compress: (bytes: Buffer) => Buffer): Buffer {
  const BOOL = -1
  const UINT = -4
  const STRING = -6
  const definitions: Array<{
    name: string
    kind: number
    fields: Array<[string, number, boolean, number]>
  }> = [
    {
      name: "NodeType",
      kind: 0,
      fields: [
        ["DOCUMENT", 0, false, 1],
        ["CANVAS", 0, false, 2],
        ["FRAME", 0, false, 4],
        ["TEXT", 0, false, 13],
        ["SYMBOL", 0, false, 15],
        ["INSTANCE", 0, false, 16],
        ["STICKY", 0, false, 17],
      ],
    },
    {
      name: "NodePhase",
      kind: 0,
      fields: [
        ["CREATED", 0, false, 0],
        ["REMOVED", 0, false, 1],
      ],
    },
    {
      name: "GUID",
      kind: 1,
      fields: [
        ["sessionID", UINT, false, 1],
        ["localID", UINT, false, 2],
      ],
    },
    {
      name: "ParentIndex",
      kind: 1,
      fields: [
        ["guid", 2, false, 1],
        ["position", STRING, false, 2],
      ],
    },
    { name: "TextData", kind: 2, fields: [["characters", STRING, false, 1]] },
    {
      name: "SymbolData",
      kind: 2,
      fields: [
        ["symbolID", 2, false, 1],
        ["symbolOverrides", 6, true, 2],
      ],
    },
    {
      name: "NodeChange",
      kind: 2,
      fields: [
        ["guid", 2, false, 1],
        ["phase", 1, false, 2],
        ["parentIndex", 3, false, 3],
        ["type", 0, false, 4],
        ["name", STRING, false, 5],
        ["visible", BOOL, false, 6],
        ["textData", 4, false, 7],
        ["description", STRING, false, 8],
        ["internalOnly", BOOL, false, 9],
        ["symbolData", 5, false, 10],
      ],
    },
    { name: "Message", kind: 2, fields: [["nodeChanges", 6, true, 1]] },
  ]
  const schema = new KiwiWriter()
  schema.varUint(definitions.length)
  for (const definition of definitions) {
    schema.string(definition.name)
    schema.byte(definition.kind)
    schema.varUint(definition.fields.length)
    for (const [name, type, isArray, value] of definition.fields) {
      schema.string(name)
      schema.varInt(type)
      schema.byte(isArray ? 1 : 0)
      schema.varUint(value)
    }
  }

  type Node = {
    id: number
    parent?: [number, string]
    type: number
    name: string
    phase?: number
    visible?: boolean
    text?: string
    description?: string
    internalOnly?: boolean
    symbol?: { id: number; overrides: string[] }
  }
  const nodes: Node[] = [
    { id: 0, type: 1, name: "Document" },
    { id: 1, parent: [0, "!"], type: 2, name: "Checkout" },
    { id: 2, parent: [0, "~"], type: 2, name: "Internal Only Canvas", internalOnly: true },
    { id: 3, parent: [1, "a"], type: 4, name: "Payment" },
    { id: 4, parent: [3, "a"], type: 13, name: "Title", text: "Pay securely" },
    { id: 5, parent: [3, "b"], type: 13, name: "Draft", text: "Hidden draft", visible: false },
    {
      id: 6,
      parent: [3, "c"],
      type: 16,
      name: "Pay button",
      symbol: { id: 7, overrides: ["Pay 49 EUR now"] },
    },
    {
      id: 7,
      parent: [1, "b"],
      type: 15,
      name: "Primary button",
      description: "Use for the main action",
    },
    { id: 8, parent: [1, "c"], type: 17, name: "Sticky", text: "Ask legal about refunds" },
    { id: 9, parent: [3, "d"], type: 13, name: "Old", text: "Deleted layer", phase: 1 },
  ]
  const message = new KiwiWriter()
  const guid = (writer: KiwiWriter, id: number) => {
    writer.varUint(1)
    writer.varUint(id)
  }
  const text = (writer: KiwiWriter, characters: string) => {
    writer.varUint(1)
    writer.string(characters)
    writer.varUint(0)
  }
  message.varUint(1)
  message.varUint(nodes.length)
  for (const node of nodes) {
    message.varUint(1)
    guid(message, node.id)
    if (node.phase !== undefined) {
      message.varUint(2)
      message.varUint(node.phase)
    }
    if (node.parent) {
      message.varUint(3)
      guid(message, node.parent[0])
      message.string(node.parent[1])
    }
    message.varUint(4)
    message.varUint(node.type)
    message.varUint(5)
    message.string(node.name)
    if (node.visible !== undefined) {
      message.varUint(6)
      message.byte(node.visible ? 1 : 0)
    }
    if (node.text !== undefined) {
      message.varUint(7)
      text(message, node.text)
    }
    if (node.description !== undefined) {
      message.varUint(8)
      message.string(node.description)
    }
    if (node.internalOnly) {
      message.varUint(9)
      message.byte(1)
    }
    if (node.symbol) {
      message.varUint(10)
      message.varUint(1)
      guid(message, node.symbol.id)
      message.varUint(2)
      message.varUint(node.symbol.overrides.length)
      for (const override of node.symbol.overrides) {
        message.varUint(7)
        text(message, override)
        message.varUint(0)
      }
      message.varUint(0)
    }
    message.varUint(0)
  }
  message.varUint(0)

  const chunk = (bytes: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32LE(bytes.length)
    return Buffer.concat([length, bytes])
  }
  const version = Buffer.alloc(4)
  version.writeUInt32LE(106)
  const canvas = Buffer.concat([
    Buffer.from("fig-kiwi", "latin1"),
    version,
    chunk(compress(schema.buffer())),
    chunk(compress(message.buffer())),
  ])
  return Buffer.from(
    zipSync(
      { "canvas.fig": canvas, "meta.json": strToU8('{"file_name":"Checkout"}') },
      { level: 0 },
    ),
  )
}

class KiwiWriter {
  private readonly bytes: number[] = []

  byte(value: number): void {
    this.bytes.push(value & 255)
  }

  varUint(value: number): void {
    let remaining = value >>> 0
    do {
      let byte = remaining & 127
      remaining >>>= 7
      if (remaining) byte |= 128
      this.bytes.push(byte)
    } while (remaining)
  }

  varInt(value: number): void {
    this.varUint((value << 1) ^ (value >> 31))
  }

  string(value: string): void {
    this.bytes.push(...Buffer.from(value, "utf8"), 0)
  }

  buffer(): Buffer {
    return Buffer.from(this.bytes)
  }
}

async function parseFixture(name: string, content: string | Buffer): Promise<ParsedDocument> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ragmir-formats-"))
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
