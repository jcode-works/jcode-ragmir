import * as lancedb from "@lancedb/lancedb";
import type { Config, VectorRow } from "./types.js";
export declare function writeRows(rows: VectorRow[], config: Config): Promise<void>;
export declare function openRowsTable(config: Config): Promise<lancedb.Table | null>;
export declare function countRows(config: Config): Promise<number>;
//# sourceMappingURL=store.d.ts.map