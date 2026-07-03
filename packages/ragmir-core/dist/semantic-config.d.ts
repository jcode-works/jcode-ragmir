export interface EnableSemanticEmbeddingsResult {
    configPath: string;
    embeddingProvider: "transformers";
    embeddingModel: string;
    embeddingModelPath: string;
    transformersAllowRemoteModels: false;
}
export declare function enableSemanticEmbeddings(cwd?: string): Promise<EnableSemanticEmbeddingsResult>;
//# sourceMappingURL=semantic-config.d.ts.map