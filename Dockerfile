FROM node:20-alpine

WORKDIR /app

COPY package.json yarn.lock rps-core.js ./
RUN yarn install --production

COPY index.js ./

CMD ["node", "index.js"]
