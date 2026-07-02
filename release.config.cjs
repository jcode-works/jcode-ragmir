module.exports = {
  branches: ["main"],
  repositoryUrl: "https://github.com/jcode-works/jcode-mimir.git",
  tagFormat: "v$" + "{version}",
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        // The landing site is an unpublished surface; its commits must never
        // trigger a version bump or npm publish of the library packages.
        // Documentation updates publish a patch so the npm readme stays current.
        releaseRules: [
          { scope: "landing", release: false },
          { type: "docs", release: "patch" },
        ],
      },
    ],
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/exec",
      {
        verifyConditionsCmd: "node scripts/semantic-release-verify.mjs",
        prepareCmd: "node scripts/semantic-release-prepare.mjs $" + "{nextRelease.version}",
        publishCmd: "node scripts/semantic-release-publish.mjs $" + "{nextRelease.version}",
      },
    ],
    [
      "@semantic-release/github",
      {
        assets: ["release-artifacts/*"],
      },
    ],
  ],
}
