
FROM alpine:latest

WORKDIR /node-resque-demo

RUN apk add --update nodejs nodejs-npm

COPY package.json .
COPY tsconfig.json .
COPY src src

# npm install will also run npm prepare, compiling the typescript
RUN npm install --unsafe-perm
RUN npm prune

CMD ["node", "dist/producer.js"]
