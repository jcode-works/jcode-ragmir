export declare const DEFAULT_TTS_MODEL = "Xenova/mms-tts-fra";
export declare const DEFAULT_TTS_MODEL_PATH = ".mimir/models/tts";
export declare const DEFAULT_AUDIO_DIR = ".mimir/audio";
export declare const DEFAULT_TTS_ENGINE = "transformers";
export declare const DEFAULT_TTS_ALLOW_REMOTE_MODELS = false;
export declare const DEFAULT_EDGE_VOICE = "fr-FR-DeniseNeural";
export declare const DEFAULT_EDGE_RATE = "+0%";
export declare const DEFAULT_TTS_LANGUAGE: TtsLanguage;
export type TtsEngine = "auto" | "edge" | "transformers";
export type OutputFormat = "mp3" | "wav";
export declare const TTS_LANGUAGES: readonly ["en", "es", "fr"];
export type TtsLanguage = (typeof TTS_LANGUAGES)[number];
export declare function isTtsLanguage(value: string): value is TtsLanguage;
export interface TextToAudioOutputLike {
    save(path: string): Promise<void>;
    sampling_rate?: number;
    data?: Float32Array;
}
export type TextToAudioSynthesizer = (text: string, options?: TextToAudioOptions) => Promise<TextToAudioOutputLike>;
export interface TextToAudioOptions {
    speaker_embeddings?: string;
    speed?: number;
}
export interface RenderSpeechOptions {
    cwd?: string;
    text?: string;
    textFile?: string;
    outputPath?: string;
    engine?: TtsEngine;
    language?: TtsLanguage;
    model?: string;
    modelPath?: string;
    allowRemoteModels?: boolean;
    voice?: string;
    rate?: string;
    speakerEmbeddings?: string;
    speed?: number;
    synthesizer?: TextToAudioSynthesizer;
    edgeRenderer?: EdgeTtsRenderer;
    edgeAvailable?: () => boolean;
}
export interface RenderSpeechResult {
    outputPath: string;
    engine: Exclude<TtsEngine, "auto">;
    language: TtsLanguage;
    outputFormat: OutputFormat;
    model: string;
    modelPath: string;
    allowRemoteModels: boolean;
    voice: string | null;
    rate: string | null;
    samplingRate: number | null;
    samples: number | null;
}
export interface DoctorReport {
    node: string;
    defaultEngine: TtsEngine;
    defaultLanguage: TtsLanguage;
    languages: TtsLanguage[];
    defaultModel: string;
    defaultModelPath: string;
    defaultAllowRemoteModels: boolean;
    transformersAvailable: boolean;
    edgeTtsAvailable: boolean;
    edgeDefaultVoice: string;
    pythonRequired: false;
    ffmpegRequired: false;
    outputFormat: "mp3-or-wav";
}
export type EdgeTtsRenderer = (options: EdgeTtsRenderOptions) => Promise<void>;
export interface EdgeTtsRenderOptions {
    text: string;
    outputPath: string;
    voice: string;
    rate: string;
}
export declare function renderSpeech(options: RenderSpeechOptions): Promise<RenderSpeechResult>;
export declare function doctor(): Promise<DoctorReport>;
export declare function mmsModelForLanguage(language: TtsLanguage): string;
export declare function edgeVoiceForLanguage(language: TtsLanguage): string;
export declare function modelCacheExists(cwd?: string): boolean;
//# sourceMappingURL=index.d.ts.map