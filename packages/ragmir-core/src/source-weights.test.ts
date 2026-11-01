import { describe, expect, it } from "vitest"
import { chunkLexicalText } from "./chunking.js"
import {
  definitionBoostOf,
  fileNameBoostOf,
  headingBoostOf,
  localeDocumentKey,
  sourceWeightOf,
} from "./source-weights.js"

describe("localeDocumentKey", () => {
  it("collapses translations of one document across common layouts", () => {
    const groups = [
      ["apps/landing/messages/fr.json", "apps/landing/messages/en.json"],
      ["locales/pt-BR/common.json", "locales/de/common.json"],
      ["docs/fr-FR/guide.md", "docs/en-US/guide.md"],
      ["README.fr.md", "README.de.md"],
      ["src/main/resources/messages_fr.properties", "src/main/resources/messages_es.properties"],
      ["app/src/main/res/values-fr/strings.xml", "app/src/main/res/values-pt-rBR/strings.xml"],
      ["ios/App/fr.lproj/Localizable.strings", "ios/App/zh-Hans.lproj/Localizable.strings"],
      ["src/translations/fr.ts", "src/translations/en.ts"],
      ["scripts/translations/exercises-en.json", "scripts/translations/exercises-fr.json"],
    ]
    for (const [left = "", right = ""] of groups) {
      expect(localeDocumentKey(left)).toBe(localeDocumentKey(right))
      expect(localeDocumentKey(left)).toContain("{locale}")
    }
  })

  it("keeps folders and files that only look like language codes", () => {
    for (const relativePath of [
      "src/id/user.ts",
      "src/it/helpers.ts",
      "docs/to/do.md",
      "lib/db/index.ts",
      "notes/meeting-fr.md",
      "data/fr.csv",
    ]) {
      expect(localeDocumentKey(relativePath)).toBe(relativePath)
    }
  })
})

describe("sourceWeightOf", () => {
  it("multiplies path priors and configured weights, and lets configuration override priors", () => {
    const weightOf = sourceWeightOf({
      pathPriors: true,
      sourceWeights: { "archive/**": 0.5, "**/*.{test,spec}.*": 1 },
    })

    expect(weightOf("src/auth/PermissionService.java")).toBe(1)
    expect(weightOf("src/auth/PermissionServiceTest.java")).toBe(0.85)
    expect(weightOf("src/auth/permission.test.ts")).toBe(1)
    expect(weightOf("archive/tests/old.md")).toBeCloseTo(0.425)
    expect(sourceWeightOf({ pathPriors: false, sourceWeights: {} })("tests/a.md")).toBe(1)
  })
})

describe("definitionBoostOf", () => {
  it("boosts code that defines what the question names, not prose that mentions it", () => {
    const boost = definitionBoostOf(["permissions", "checked"])

    expect(
      boost(
        codeRow(
          "src/auth/PermissionService.java",
          "public class PermissionService {\n  public boolean check(Role role) {",
        ),
      ),
    ).toBeCloseTo(1.14)
    expect(boost(codeRow("docs/permissions.md", "class PermissionService checks access."))).toBe(1)
    expect(boost(codeRow("src/util.ts", "export function formatDate() {}"))).toBe(1)
  })

  it("skips passages whose keyword text holds no stem of a query word", () => {
    const boost = definitionBoostOf(["permissions"])
    const row = codeRow("src/auth/PermissionService.java", "public class PermissionService {}")

    expect(boost(row)).toBeCloseTo(1.07)
    expect(boost({ ...row, searchText: "unrelated keyword text" })).toBe(1)
  })
})

describe("headingBoostOf", () => {
  it("boosts passages whose heading path holds words of the question", () => {
    const boost = headingBoostOf(["authentication", "tokens", "refresh"])

    expect(boost({ contextPath: "Security > Authentication > Refresh tokens" })).toBeCloseTo(1.2)
    expect(boost({ contextPath: "$.auth.refresh" })).toBeCloseTo(1.1)
    expect(boost({ contextPath: "" })).toBe(1)
    expect(boost({})).toBe(1)
  })
})

describe("fileNameBoostOf", () => {
  it("boosts files whose name holds words of the question, two words at most", () => {
    expect(
      fileNameBoostOf(["generated", "openapi", "document"])({
        relativePath: "src/OpenApiConfig.java",
      }),
    ).toBeCloseTo(1.1)
    expect(
      fileNameBoostOf(["permission", "service"])({ relativePath: "auth/PermissionService.java" }),
    ).toBeCloseTo(1.2)
    expect(
      fileNameBoostOf(["languages", "seeded"])({ relativePath: "sql-data/init_language.sql" }),
    ).toBeCloseTo(1.1)
    expect(
      fileNameBoostOf(["role", "keys", "reference"])({
        relativePath: "security/RoleProfiles.java",
      }),
    ).toBeCloseTo(1.1)
    expect(
      fileNameBoostOf(["account", "principal", "profile"])({
        relativePath: "AccountPrincipalProfile.java",
      }),
    ).toBeCloseTo(1.2)
    expect(fileNameBoostOf(["permissions"])({ relativePath: "docs/overview.md" })).toBe(1)
    expect(fileNameBoostOf(["id"])({ relativePath: "id.ts" })).toBe(1)
  })
})

function codeRow(relativePath: string, text: string) {
  return {
    relativePath,
    text,
    searchText: chunkLexicalText({ relativePath, text, contextPath: "" }),
  }
}
