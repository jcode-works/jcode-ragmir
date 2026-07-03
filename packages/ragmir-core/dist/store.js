import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as lancedb from "@lancedb/lancedb";
import { isRecord } from "./guards.js";
const EMPTY_TEXT_FILES_MANIFEST = "empty-text-files.json";
export async function writeRows(rows, config) {
    await mkdir(config.storageDir, { recursive: true });
    const db = await lancedb.connect(config.storageDir);
    if (rows.length === 0) {
        const tableNames = await db.tableNames();
        if (tableNames.includes(config.tableName)) {
            await db.dropTable(config.tableName);
        }
        return;
    }
    const records = rows.map((row) => ({ ...row }));
    await db.createTable(config.tableName, records, {
        mode: "overwrite",
    });
}
export async function writeEmptyTextFiles(records, config) {
    const manifestPath = path.join(config.storageDir, EMPTY_TEXT_FILES_MANIFEST);
    if (records.length === 0) {
        await rm(manifestPath, { force: true });
        return;
    }
    await mkdir(config.storageDir, { recursive: true });
    const sortedRecords = [...records].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    await writeFile(manifestPath, JSON.stringify({ version: 1, files: sortedRecords }, null, 2), "utf8");
}
export async function readEmptyTextFiles(config) {
    try {
        const manifest = JSON.parse(await readFile(path.join(config.storageDir, EMPTY_TEXT_FILES_MANIFEST), "utf8"));
        if (!isRecord(manifest) || !Array.isArray(manifest.files)) {
            return [];
        }
        return manifest.files.filter(isEmptyTextFileRecord);
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}
export async function openRowsTable(config) {
    const db = await lancedb.connect(config.storageDir);
    const tableNames = await db.tableNames();
    if (!tableNames.includes(config.tableName)) {
        return null;
    }
    return db.openTable(config.tableName);
}
export async function readRows(config) {
    const table = await openRowsTable(config);
    if (!table) {
        return [];
    }
    return (await table.query().toArray()).map((row) => ({
        ...row,
        vector: normalizeVector(row.vector),
    }));
}
export async function countRows(config) {
    const table = await openRowsTable(config);
    return table ? table.countRows() : 0;
}
function normalizeVector(vector) {
    if (Array.isArray(vector) && vector.every((value) => typeof value === "number")) {
        return vector;
    }
    if (ArrayBuffer.isView(vector) && "length" in vector) {
        return Array.from(vector);
    }
    if (hasIndexedNumberGetter(vector)) {
        return Array.from({ length: vector.length }, (_, index) => vector.get(index));
    }
    throw new Error("Stored vector row is not a numeric vector.");
}
function hasIndexedNumberGetter(value) {
    return (typeof value === "object" &&
        value !== null &&
        "length" in value &&
        typeof value.length === "number" &&
        "get" in value &&
        typeof value.get === "function");
}
function isEmptyTextFileRecord(value) {
    return (isRecord(value) && typeof value.relativePath === "string" && typeof value.checksum === "string");
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
//# sourceMappingURL=store.js.map