# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app

# 설치 최적화: 먼저 package*만 복사
COPY package*.json ./
RUN npm ci

# 소스 복사 후 빌드
COPY . .
# SvelteKit node 어댑터로 빌드 (out: build/)
RUN npm run build

# 런타임에 devDeps 제외
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# 빌드 산출물 + prod 의존성만 복사
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
CMD ["node", "build"]