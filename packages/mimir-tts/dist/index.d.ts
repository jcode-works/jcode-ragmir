export declare const DEFAULT_TTS_MODEL = "Xenova/mms-tts-fra";
export declare const DEFAULT_TTS_MODEL_PATH = ".mimir/models/tts";
export declare const DEFAULT_AUDIO_DIR = ".mimir/audio";
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
    model?: string;
    modelPath?: string;
    allowRemoteModels?: boolean;
    speakerEmbeddings?: string;
    speed?: number;
    synthesizer?: TextToAudioSynthesizer;
}
export interface RenderSpeechResult {
    outputPath: string;
    model: string;
    modelPath: string;
    allowRemoteModels: boolean;
    samplingRate: number | null;
    samples: number | null;
}
export interface DoctorReport {
    node: string;
    defaultModel: string;
    defaultModelPath: string;
    transformersAvailable: boolean;
    pythonRequired: false;
    ffmpegRequired: false;
    outputFormat: "wav";
}
export declare function renderSpeech(options: RenderSpeechOptions): Promise<RenderSpeechResult>;
export declare function doctor(): Promise<DoctorReport>;
export declare function modelCacheExists(cwd?: string): boolean;
//# sourceMappingURL=index.d.ts.map