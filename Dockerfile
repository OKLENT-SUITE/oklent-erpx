# REL-01: pin the base image to a minor line (bump deliberately, then run tests/ + `npm audit`); builds install EXACTLY what package-lock.json says.
FROM node:22.22-alpine
WORKDIR /app
RUN apk add --no-cache openssl                      # ZATCA phase-2 CSR generation (api/src/zatca2/csr.js); tenant-cli never needs a shell
COPY api/package*.json api/
RUN cd api && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY api/src api/src
COPY web web
COPY docs docs
COPY db/init db/init
COPY db/platform db/platform
COPY db/schema-expected.json db/schema-expected.json
COPY cli cli
ENV NODE_ENV=production ERPX_ROOT=/app PORT=3100
RUN mkdir -p /app/uploads/products && chown -R node:node /app/uploads    # a new named volume inherits this owner, so the non-root api can write
USER node
EXPOSE 3100
CMD ["node", "api/src/server.js"]
