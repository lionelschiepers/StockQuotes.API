# Build stage
FROM mcr.microsoft.com/azure-functions/node:4-node24 AS builder

RUN npm install -g npm@latest

WORKDIR /home/site/wwwroot

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN npm run build
RUN npm prune --omit=dev


# Production stage
FROM mcr.microsoft.com/azure-functions/node:4-node24

ENV AzureWebJobsScriptRoot=/home/site/wwwroot
ENV AzureFunctionsJobHost__Logging__Console__IsEnabled=true

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /home/site/wwwroot

COPY --from=builder /home/site/wwwroot/node_modules ./node_modules
COPY --from=builder /home/site/wwwroot/dist ./dist
COPY --from=builder /home/site/wwwroot/host.json ./
COPY --from=builder /home/site/wwwroot/package.json ./

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD curl -f http://localhost:80/api/exchange-rate-ecb || exit 1

EXPOSE 80
