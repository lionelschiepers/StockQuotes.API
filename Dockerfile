# exposed on NAS with port 20002
# sample url: 
#   /api/yahoo-finance?symbols=MSFT&fields=regularMarketPrice
#   /api/exchange-rate-ecb

# To enable ssh & remote debugging on app service change the base image to the one below
# FROM mcr.microsoft.com/azure-functions/node:4-node22-appservice
FROM mcr.microsoft.com/azure-functions/node:4-node24

# ENV NODE_ENV=production

# Update package index and install a small HTTP client for healthchecks.
# Avoid running a full `apt-get upgrade` in the image to keep builds deterministic and small.
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

RUN npm install -g npm@latest

ENV AzureWebJobsScriptRoot=/home/site/wwwroot
ENV AzureFunctionsJobHost__Logging__Console__IsEnabled=true
# doesn't work as expected for an unknown reason, so added headers in the function code directly
# ENV CORS_ALLOWED_ORIGINS="[\"*\"]" 

WORKDIR /home/site/wwwroot

# copy both package.json and package-lock.json to leverage layer cache & reproducible installs
COPY package*.json ./

# prefer npm ci when a lockfile exists (faster, deterministic)
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
# RUN npm audit fix

# Copy the rest of the code
COPY *.json .
COPY ./src/ ./src/

RUN npm run build

RUN npm prune --omit=dev

# basic HTTP healthcheck for the functions host
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD curl -f http://localhost:80/api/exchange-rate-ecb || exit 1

EXPOSE 80