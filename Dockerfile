FROM node:alpine AS builder
WORKDIR /build
COPY package*.json .
RUN npm install 
COPY . .
RUN npm run build

FROM node:alpine
WORKDIR /app
COPY package*.json .

RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /build/dist ./dist

ENV PORT=3000

EXPOSE $PORT

CMD ["npm", "start"]