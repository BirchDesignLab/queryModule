# deploy/Dockerfile  (build context: repo root)
# syntax=docker/dockerfile:1.7
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS build
WORKDIR /repo
RUN corepack enable
COPY . .
# filtered install: only the api and web dependency graphs; apps/mobile and packages/rn-ui are never installed or copied
RUN pnpm install --frozen-lockfile --filter "@querymodule/api..." --filter "@querymodule/web..."
RUN pnpm --filter "@querymodule/web..." --filter "@querymodule/api..." --if-present run build
RUN pnpm --filter @querymodule/api deploy --prod --legacy /prod/api
RUN mkdir -p /prod/config \
 && cp -r packages/config/sites packages/config/locales /prod/config/ \
 && if [ -d packages/config/mock ]; then cp -r packages/config/mock /prod/config/; fi

FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS runtime
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data SECRETS_DIR=/run/secrets
RUN addgroup -S -g 10001 app && adduser -S -D -H -u 10001 -G app app \
 && mkdir -p /data && chown 10001:10001 /data
WORKDIR /app
COPY --from=build /prod/api/node_modules ./node_modules
COPY --from=build /repo/packages/api/dist/main.js /repo/packages/api/dist/main.js.map ./dist/
COPY --from=build /repo/packages/api/dist/ops ./scripts/ops
COPY --from=build /repo/packages/api/drizzle ./drizzle
COPY --from=build /prod/config ./config
COPY --from=build /repo/apps/web/dist ./web
USER 10001
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
