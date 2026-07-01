module.exports = {
  branches: ["main"],
  repositoryUrl: "https://github.com/jcode-works/jcode-mimir.git",
  tagFormat: "v$" + "{version}",
  plugins: [
    "@semantic-release/commit-analyzer",
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
