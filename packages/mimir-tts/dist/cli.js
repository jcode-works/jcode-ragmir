#!/usr/bin/env node
import { parseArgs } from "node:util";
import { doctor, renderSpeech } from "./index.js";
const command = process.argv[2];
try {
    if (command === "doctor") {
        await runDoctor(process.argv.slice(3));
    }
    else if (command === "render") {
        await runRender(process.argv.slice(3));
    }
    else {
        printHelp();
        process.exitCode = command ? 1 : 0;
    }
}
catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
async function runDoctor(args) {
    const { values } = parseArgs({
        args,
        options: {
            json: { type: "boolean" },
        },
    });
    const report = await doctor();
    if (values.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
    }
    printKeyValue("node", report.node);
    printKeyValue("defaultModel", report.defaultModel);
    printKeyValue("defaultModelPath", report.defaultModelPath);
    printKeyValue("transformersAvailable", String(report.transformersAvailable));
    printKeyValue("pythonRequired", String(report.pythonRequired));
    printKeyValue("ffmpegRequired", String(report.ffmpegRequired));
    printKeyValue("outputFormat", report.outputFormat);
}
async function runRender(args) {
    const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: {
            out: { type: "string", short: "o" },
            model: { type: "string" },
            "model-path": { type: "string" },
            offline: { type: "boolean" },
            "allow-remote-models": { type: "boolean" },
            "speaker-embeddings": { type: "string" },
            speed: { type: "string" },
            json: { type: "boolean" },
        },
    });
    const textFile = positionals[0];
    if (!textFile) {
        throw new Error("usage: mimir-tts render <text-file> [--out output.wav]");
    }
    const renderOptions = {
        textFile,
    };
    addStringOption(renderOptions, "outputPath", stringValue(values, "out"));
    addStringOption(renderOptions, "model", stringValue(values, "model"));
    addStringOption(renderOptions, "modelPath", stringValue(values, "model-path"));
    addBooleanOption(renderOptions, "allowRemoteModels", allowRemoteModels(values));
    addStringOption(renderOptions, "speakerEmbeddings", stringValue(values, "speaker-embeddings"));
    addNumberOption(renderOptions, "speed", numberValue(values, "speed"));
    const result = await renderSpeech(renderOptions);
    if (values.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    printKeyValue("outputPath", result.outputPath);
    printKeyValue("model", result.model);
    printKeyValue("modelPath", result.modelPath);
    printKeyValue("allowRemoteModels", String(result.allowRemoteModels));
    printKeyValue("samplingRate", String(result.samplingRate ?? "unknown"));
    printKeyValue("samples", String(result.samples ?? "unknown"));
}
function allowRemoteModels(values) {
    if (values.offline === true) {
        return false;
    }
    if (values["allow-remote-models"] === true) {
        return true;
    }
    return undefined;
}
function stringValue(values, key) {
    const value = values[key];
    return typeof value === "string" ? value : undefined;
}
function addStringOption(target, key, value) {
    if (value !== undefined) {
        target[key] = value;
    }
}
function addBooleanOption(target, key, value) {
    if (value !== undefined) {
        target[key] = value;
    }
}
function addNumberOption(target, key, value) {
    if (value !== undefined) {
        target[key] = value;
    }
}
function numberValue(values, key) {
    const value = stringValue(values, key);
    if (!value) {
        return undefined;
    }
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Expected a number for --${key}.`);
    }
    return parsed;
}
function printKeyValue(key, value) {
    console.log(`${key}=${value}`);
}
function printHelp() {
    console.log(`mimir-tts

Usage:
  mimir-tts doctor [--json]
  mimir-tts render <text-file> [--out output.wav] [--offline]

Options:
  --model <id>                 Transformers.js TTS model ID.
  --model-path <path>          Local model/cache path. Defaults to .mimir/models/tts.
  --offline                    Disable remote model downloads.
  --allow-remote-models        Explicitly allow remote model downloads.
  --speaker-embeddings <path>  Optional model-specific speaker embedding path or URL.
  --speed <number>             Optional model-specific speech speed.
  --json                       Print JSON output.
`);
}
//# sourceMappingURL=cli.js.map