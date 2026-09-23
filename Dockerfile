# Floor Tape — Cloud Run image.
# Build: docker build -t floor-tape .
# Run:   docker run --rm -p 8080:8080 -e HOST=0.0.0.0 -e PORT=8080 floor-tape
# No secrets. Filings are re-ingested into ephemeral PGLite on first request.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build \
  && cp node_modules/@electric-sql/pglite/dist/pglite.wasm .output/server/_libs/pglite.wasm \
  && cp node_modules/@electric-sql/pglite/dist/initdb.wasm .output/server/_libs/initdb.wasm \
  && cp node_modules/@electric-sql/pglite/dist/pglite.data .output/server/_libs/pglite.data

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends tesseract-ocr \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080
COPY --from=build /app/.output ./.output
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts/ocr-pdf.mjs ./scripts/ocr-pdf.mjs
COPY --from=build /app/node_modules/unpdf ./node_modules/unpdf
COPY --from=build /app/node_modules/@napi-rs ./node_modules/@napi-rs
EXPOSE 8080
CMD ["node", ".output/server/index.mjs"]
