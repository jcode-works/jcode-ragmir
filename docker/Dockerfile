# Official Ragmir images: the published `rgr` CLI and stdio MCP server on Node.js 22.
#
#   slim  ghcr.io/jcode-works/ragmir:<version>       local-hash retrieval, no model runtime
#   full  ghcr.io/jcode-works/ragmir:<version>-full  adds the semantic model runtime and local OCR
#
# The release workflow builds both targets for linux/amd64 and linux/arm64 from the npm version it
# just published. Mount the project to index at /workspace; the index stays on that mount.
FROM node:22-bookworm-slim AS slim

ARG RAGMIR_VERSION

LABEL org.opencontainers.image.title="Ragmir" \
      org.opencontainers.image.description="Cited local retrieval for agents: rgr CLI and stdio MCP server" \
      org.opencontainers.image.source="https://github.com/jcode-works/ragmir" \
      org.opencontainers.image.url="https://ragmir.com" \
      org.opencontainers.image.documentation="https://github.com/jcode-works/ragmir/blob/main/docs/docker.md" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.vendor="JCode Works" \
      org.opencontainers.image.version="${RAGMIR_VERSION}" \
      io.modelcontextprotocol.server.name="io.github.jcode-works/ragmir"

RUN test -n "${RAGMIR_VERSION}" \
  && npm install --global --omit=dev --no-audit --no-fund "@jcode.labs/ragmir@${RAGMIR_VERSION}" \
  && npm cache clean --force \
  && mkdir -p /workspace \
  && chown node:node /workspace

# Runs as node, or as any --user the host passes so files under .ragmir/ belong to the caller.
USER node
WORKDIR /workspace
ENTRYPOINT ["rgr"]
CMD ["--help"]

FROM slim AS full

# Pinned to the version the Core package is tested with.
ARG TRANSFORMERS_VERSION=4.3.2

USER root
# Tesseract with common European languages and Poppler for scanned PDFs and images, antiword for
# legacy .doc files: `rgr ocr setup --images --legacy-word` finds them on PATH.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    antiword \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-deu \
    tesseract-ocr-eng \
    tesseract-ocr-fra \
    tesseract-ocr-ita \
    tesseract-ocr-por \
    tesseract-ocr-spa \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global --omit=dev --no-audit --no-fund \
    "@huggingface/transformers@${TRANSFORMERS_VERSION}" \
  && npm cache clean --force
USER node
