# Official Ragmir image: the published `rgr` CLI and stdio MCP server on Node.js 22.
# The release workflow builds it for linux/amd64 and linux/arm64 from the npm version it just
# published. Mount the project to index at /workspace and keep the index on that mount or a volume.
FROM node:22-bookworm-slim

ARG RAGMIR_VERSION

LABEL org.opencontainers.image.title="Ragmir" \
      org.opencontainers.image.description="Cited local retrieval for agents: rgr CLI and stdio MCP server" \
      org.opencontainers.image.source="https://github.com/jcode-works/jcode-ragmir" \
      org.opencontainers.image.url="https://ragmir.com" \
      org.opencontainers.image.documentation="https://github.com/jcode-works/jcode-ragmir/blob/main/docs/server-deployment.md" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${RAGMIR_VERSION}"

RUN test -n "${RAGMIR_VERSION}" \
  && npm install --global --omit=dev --no-audit --no-fund "@jcode.labs/ragmir@${RAGMIR_VERSION}" \
  && npm cache clean --force \
  && mkdir -p /workspace \
  && chown node:node /workspace

USER node
WORKDIR /workspace
ENTRYPOINT ["rgr"]
CMD ["--help"]
