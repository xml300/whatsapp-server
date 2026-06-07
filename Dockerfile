FROM node:alpine AS builder
WORKDIR /app
ENV npm_config_platform=linuxmusl
RUN apk add --no-cache curl && \
    curl -sf https://gobinaries.com/tj/node-prune | sh -s -- -b /usr/local/bin
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV NODE_ENV=production
RUN npm ci --omit=dev && npm cache clean --force && \
    rm -rf node_modules/@img/sharp-linux-x64 \
           node_modules/@img/sharp-libvips-linux-x64
RUN /usr/local/bin/node-prune ./node_modules


FROM alpine:3.21
RUN apk add --no-cache nodejs \
    && addgroup -S appgroup \
    && adduser -S appuser -G appgroup

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

RUN touch server.log && chown appuser:appgroup server.log
USER appuser

EXPOSE 3000
CMD ["node", "dist/index.js"]