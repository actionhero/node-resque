
FROM alpine:latest
MAINTAINER admin@actionherojs.com

WORKDIR /node-resque

RUN apk add --update nodejs nodejs-npm
COPY package.json .
COPY worker.ts .
RUN npm install

CMD ["node", "-r", "ts-node/register", "worker.ts"]
