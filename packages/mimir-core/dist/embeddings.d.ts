import type { Config } from "./types.js";
export interface PullEmbeddingModelResult {
    embeddingModel: string;
    embeddingModelPath: string;
}
export declare function embedTexts(texts: string[], config: Config): Promise<number[][]>;
export declare function pullEmbeddingModel(config: Config): Promise<PullEmbeddingModelResult>;
export declare function embedText(text: string, config: Config): Promise<number[]>;
//# sourceMappingURL=embeddings.d.ts.map