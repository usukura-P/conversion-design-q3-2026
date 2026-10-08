FROM node:24-alpine
RUN apk add --no-cache git openssh-client ca-certificates
WORKDIR /app
COPY --chown=node:node server/ ./server/
USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "server/index.mjs"]
