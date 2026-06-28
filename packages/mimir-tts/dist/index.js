import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
export const DEFAULT_TTS_MODEL = "Xenova/mms-tts-fra";
export const DEFAULT_TTS_MODEL_PATH = ".mimir/models/tts";
export const DEFAULT_AUDIO_DIR = ".mimir/audio";
export async function renderSpeech(options) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const text = await readInputText(options);
    const model = options.model ?? process.env.MIMIR_TTS_MODEL ?? DEFAULT_TTS_MODEL;
    const modelPath = resolveFromCwd(cwd, options.modelPath ?? process.env.MIMIR_TTS_MODEL_PATH ?? DEFAULT_TTS_MODEL_PATH);
    const outputPath = resolveFromCwd(cwd, options.outputPath ?? defaultOutputPath(cwd, options.textFile));
    const allowRemoteModels = options.allowRemoteModels ?? readBooleanEnv("MIMIR_TTS_ALLOW_REMOTE_MODELS", true);
    await mkdir(path.dirname(outputPath), { recursive: true });
    const synthesizer = options.synthesizer ?? (await transformerSynthesizer(model, modelPath, allowRemoteModels));
    const output = await synthesizer(text, textToAudioOptions(options));
    await output.save(outputPath);
    return {
        outputPath,
        model,
        modelPath,
        allowRemoteModels,
        samplingRate: typeof output.sampling_rate === "number" ? output.sampling_rate : null,
        samples: output.data instanceof Float32Array ? output.data.length : null,
    };
}
export async function doctor() {
    return {
        node: process.versions.node,
        defaultModel: DEFAULT_TTS_MODEL,
        defaultModelPath: DEFAULT_TTS_MODEL_PATH,
        transformersAvailable: await canImportTransformers(),
        pythonRequired: false,
        ffmpegRequired: false,
        outputFormat: "wav",
    };
}
async function readInputText(options) {
    const text = options.text ?? (options.textFile ? await readFile(options.textFile, "utf8") : "");
    const trimmed = text.trim();
    if (!trimmed) {
        throw new Error("A non-empty text input or text file is required.");
    }
    return trimmed;
}
function defaultOutputPath(cwd, textFile) {
    const name = textFile ? path.basename(textFile, path.extname(textFile)) : "mimir-summary";
    return path.join(cwd, DEFAULT_AUDIO_DIR, `${name}.wav`);
}
function resolveFromCwd(cwd, input) {
    return path.isAbsolute(input) ? input : path.resolve(cwd, input);
}
function textToAudioOptions(options) {
    const output = {};
    if (options.speakerEmbeddings) {
        output.speaker_embeddings = options.speakerEmbeddings;
    }
    if (typeof options.speed === "number") {
        output.speed = options.speed;
    }
    return Object.keys(output).length > 0 ? output : undefined;
}
async function transformerSynthesizer(model, modelPath, allowRemoteModels) {
    const transformers = await import("@huggingface/transformers");
    transformers.env.localModelPath = modelPath;
    transformers.env.cacheDir = modelPath;
    transformers.env.allowRemoteModels = allowRemoteModels;
    return (await transformers.pipeline("text-to-speech", model));
}
async function canImportTransformers() {
    try {
        await import("@huggingface/transformers");
        return true;
    }
    catch {
        return false;
    }
}
function readBooleanEnv(name, fallback) {
    const raw = process.env[name]?.toLowerCase();
    if (raw === "1" || raw === "true" || raw === "yes") {
        return true;
    }
    if (raw === "0" || raw === "false" || raw === "no") {
        return false;
    }
    return fallback;
}
export function modelCacheExists(cwd = process.cwd()) {
    return existsSync(path.resolve(cwd, process.env.MIMIR_TTS_MODEL_PATH ?? DEFAULT_TTS_MODEL_PATH));
}
//# sourceMappingURL=index.js.map