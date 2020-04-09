
FROM alpine:latest
MAINTAINER admin@actionherojs.com

WORKDIR /node-resque

RUN apk add --update nodejs nodejs-npm
COPY package.json .
COPY producer.ts .
RUN npm install

CMD ["node", "-r", "ts-node/register", "producer.ts"]
