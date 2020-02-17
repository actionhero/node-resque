
FROM alpine:latest
MAINTAINER admin@actionherojs.com

WORKDIR /node-resque

COPY package*.json ./
RUN apk add --update nodejs nodejs-npm
COPY package.json .
COPY worker.js .
RUN npm install

CMD ["node", "worker.js"]
