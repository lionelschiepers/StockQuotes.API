# exposed on NAS with port 20002
# sample url: 
#   /api/yahoo-finance?symbols=MSFT&fields=regularMarketPrice
#   /api/exchange-rate-ecb
#   /api/statements?ticker=MSFT
#   /api/statements?ticker=MSFT&period=quarterly&limitStatements=4
#   /api/statements?ticker=MSFT&period=yearly&limitStatements=4
#   /api/statements?ticker=MSFT&period=yearly&limitStatements=4&fields=incomeStatement.grossProfit|balanceSheet.totalAssets
#   /api/yahoo-finance-historical?ticker=MSFT&from=2020-01-01&to=2026-02-01&interval=1wk&fields=open,close,low

ARG ALPHAVANTAGE_API_KEY=demo

# Build stage
FROM mcr.microsoft.com/azure-functions/node:4-node24 AS builder

RUN npm install -g npm@latest

WORKDIR /home/site/wwwroot

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN npm run build && \
    npm prune --omit=dev

# Production stage
FROM mcr.microsoft.com/azure-functions/node:4-node24

ENV AzureWebJobsScriptRoot=/home/site/wwwroot
ENV AzureFunctionsJobHost__Logging__Console__IsEnabled=true

ARG ALPHAVANTAGE_API_KEY
ENV ALPHAVANTAGE_API_KEY=${ALPHAVANTAGE_API_KEY}

ENV CACHE_ENABLED=true
ENV CACHE_PERSISTENCE_ENABLED=true

# Security hardening - update packages and install only necessary tools
 RUN apt-get update && \
     apt-get upgrade -y && \
     apt-get install -y --no-install-recommends curl ca-certificates && \
     rm -rf /var/lib/apt/lists/* && \
     npm r -g npm

# Create dedicated non-root user for security
RUN useradd -m appuser && \
    mkdir -p /home/site/wwwroot && \
    chown appuser:appuser /home/site/wwwroot

USER appuser

WORKDIR /home/site/wwwroot

COPY --from=builder /home/site/wwwroot/node_modules ./node_modules
COPY --from=builder /home/site/wwwroot/dist ./dist
COPY --from=builder /home/site/wwwroot/host.json ./
COPY --from=builder /home/site/wwwroot/package.json ./

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD curl -f http://localhost:80/api/exchange-rate-ecb || exit 1

EXPOSE 80
