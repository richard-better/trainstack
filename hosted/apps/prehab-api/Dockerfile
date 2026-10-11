FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY hosted/apps/prehab-api/dist/server ./server

ENV NODE_ENV=production
ENV PORT=3002
EXPOSE 3002

CMD ["./server"]
