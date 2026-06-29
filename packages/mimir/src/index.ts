export { loadConfig } from "./config.js"
export { destroyIndex } from "./destroy.js"
export { doctor } from "./doctor.js"
export { audit, ingest } from "./ingest.js"
export { initProject } from "./init.js"
export { serveMcp } from "./mcp.js"
export type { PackageManager } from "./package-manager.js"
export { detectPackageManager, kbCommand } from "./package-manager.js"
export { ask, search } from "./query.js"
export { redactText } from "./redaction.js"
export { securityAudit } from "./security.js"
export type { SetupResult } from "./setup.js"
export { setupProject } from "./setup.js"
export type {
  AgentInstallMode,
  AgentInstallScope,
  AgentSkillInstallation,
  AgentTarget,
} from "./skill.js"
export {
  bundledSkillPath,
  installAgentSkills,
  installSkill,
  parseAgentTargets,
  SUPPORTED_AGENT_TARGETS,
} from "./skill.js"
export type {
  AskResult,
  AuditReport,
  Config,
  DestroyIndexResult,
  DoctorReport,
  IngestResult,
  SearchResult,
  SecurityAuditReport,
} from "./types.js"
export { VERSION } from "./version.js"
