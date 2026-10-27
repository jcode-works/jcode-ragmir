import { describe, expect, it } from "vitest"
import { definitionBoostOf, localeDocumentKey, sourceWeightOf } from "./source-weights.js"

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
      boost({
        relativePath: "src/auth/PermissionService.java",
        text: "public class PermissionService {\n  public boolean check(Role role) {",
      }),
    ).toBeCloseTo(1.14)
    expect(
      boost({
        relativePath: "docs/permissions.md",
        text: "class PermissionService checks access.",
      }),
    ).toBe(1)
    expect(boost({ relativePath: "src/util.ts", text: "export function formatDate() {}" })).toBe(1)
  })
})
