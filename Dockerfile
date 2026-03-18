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

EXPOSE 3000

CMD ["npm", "run", "start"]