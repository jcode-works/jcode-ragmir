import type { Config } from "./types.js";
export declare const MIMIR_DIR = ".mimir";
export declare const LEGACY_KB_DIR = ".kb";
export declare const LEGACY_PRIVATE_DIR = "private";
export declare const MIMIR_RAW_DIR = ".mimir/raw";
export declare const CONFIG_PATH = ".mimir/config.json";
export declare const LEGACY_CONFIG_PATH = ".kb/config.json";
export declare const DEFAULT_SKILL_TARGET_DIR = ".mimir/skills";
export declare const MIMIR_PROJECT_ROOT_ENV = "MIMIR_PROJECT_ROOT";
export declare const SOURCES_FILE_HEADER: string[];
export declare const MIMIR_GITIGNORE_ENTRY = ".mimir/";
export declare const LEGACY_KB_GITIGNORE_ENTRY = ".kb/";
export declare const LEGACY_PRIVATE_GITIGNORE_ENTRY = "private/";
export declare const LEGACY_PRIVATE_GITIGNORE_FALLBACK_ENTRY = "private/**";
export declare const DEFAULT_CONFIG: Omit<Config, "projectRoot">;
export declare const LEGACY_DEFAULT_CONFIG: Omit<Config, "projectRoot">;
//# sourceMappingURL=defaults.d.ts.map