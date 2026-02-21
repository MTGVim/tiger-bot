FROM node:20-alpine

WORKDIR /app

# watchtower one-shot 업데이트 실행을 위해 docker CLI 필요
RUN apk add --no-cache docker-cli

COPY package.json yarn.lock rps-core.js ./
RUN yarn install --production

COPY index.js ./

CMD ["node", "index.js"]
