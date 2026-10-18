FROM node:22-alpine
WORKDIR /app
COPY api/package*.json api/
RUN cd api && npm install --omit=dev --no-audit --no-fund
COPY api/src api/src
COPY web web
COPY docs docs
COPY db/init db/init
COPY cli cli
ENV NODE_ENV=production ERPX_ROOT=/app PORT=3100
RUN mkdir -p /app/uploads/products && chown -R node:node /app/uploads    # a new named volume inherits this owner, so the non-root api can write
USER node
EXPOSE 3100
CMD ["node", "api/src/server.js"]
