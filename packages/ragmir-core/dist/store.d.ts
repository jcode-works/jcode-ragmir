import * as lancedb from "@lancedb/lancedb";
import type { Config, VectorRow } from "./types.js";
export interface EmptyTextFileRecord {
    relativePath: string;
    checksum: string;
}
export declare function writeRows(rows: VectorRow[], config: Config): Promise<void>;
export declare function writeEmptyTextFiles(records: EmptyTextFileRecord[], config: Config): Promise<void>;
export declare function readEmptyTextFiles(config: Config): Promise<EmptyTextFileRecord[]>;
export declare function openRowsTable(config: Config): Promise<lancedb.Table | null>;
export declare function readRows(config: Config): Promise<VectorRow[]>;
export declare function countRows(config: Config): Promise<number>;
//# sourceMappingURL=store.d.ts.map