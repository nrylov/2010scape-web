FROM oven/bun:1.4.3-debian

WORKDIR /app
ENV NODE_ENV=production \
    BIND_HOST=0.0.0.0 \
    PORT=3000

# The application uses Bun's built-in HTTP and SQL APIs; no runtime packages.
COPY --chown=bun:bun package.json ./
COPY --chown=bun:bun src ./src
COPY --chown=bun:bun public ./public
RUN mkdir -p /app/local/data && chown -R bun:bun /app/local

USER bun
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "const r=await fetch('http://127.0.0.1:'+(process.env.PORT||'3000')+'/healthz',{signal:AbortSignal.timeout(4000)});process.exit(r.ok?0:1)"]
CMD ["bun", "src/server.ts"]
