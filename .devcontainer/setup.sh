#!/usr/bin/env bash

echo "--- CONFIURING CODESPACE ---"

sudo apt-get install redis-tools
docker run -p 6379:6379 --name redis -d redis
