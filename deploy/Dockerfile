# anton.computer agent Docker image
# Usage: docker run -d -p 9876:9876 -e ANTHROPIC_API_KEY=sk-... anton/agent

FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    openssl \
    # Document-processing tools: the agent reads uploaded docs via its
    # `read` / `bash` tools on demand rather than pre-parsing in harness.
    #   - poppler-utils: pdftotext for PDF extraction
    #   - pandoc:        docx → plain / markdown / html conversion
    #   - python3-pandas + python3-openpyxl: pandas.read_excel(...) path
    #   - xlsx2csv:      quick shell-friendly xlsx → csv
    poppler-utils \
    pandoc \
    python3-pandas \
    python3-openpyxl \
    xlsx2csv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and build agent
COPY packages/protocol/ packages/protocol/
COPY packages/agent/ packages/agent/
COPY package.json pnpm-workspace.yaml ./

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @anton/protocol build
RUN pnpm --filter @anton/agent build

# Create anton user
RUN useradd -m -s /bin/bash anton
USER anton

EXPOSE 9876

CMD ["node", "packages/agent/dist/index.js"]
