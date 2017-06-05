# Ruby Resque UI

This directory contains a small ruby project which will run the resque web server.  This is contained within the node-resque project so that we can test and confirm that node-resque is interoperable with ruby-resque.

1) **install ruby**

Ensure that you have ruby installed on your system.  You can confirm this with `ruby --version`.  You can get ruby from [ruby-lang.org](https://www.ruby-lang.org) if you don't have it.   OSX comes with ruby, and most linux distributions have a top-level package (i.e.: `apt-get install ruby`)

2) **install bundler**

Bundler is the ruby package manager (think NPM).  Ruby uses "gems" (packages), and bundler is a tool that can manage dependencies of a project.  A `Gemfile` contains a list of dependancies and a `Gemfile.lock` is like a `npm shinkwrap` output, formally defining gem versions.  

Install bundler with `gem install bundler` (the `gem` application is included with ruby)

3) **install the packages**

From within this directory, run `bundle install`.  This equivalent to `npm install`

4) **run the application**

The ruby-resque package includes a web interface which can be "mounted" within a number of common ruby web frameworks, like sintatra, ruby-on-rails, etc.  I have included the smallest possible application which is a [`rack`](http://rack.github.io/) application.  To run this application, type `bundle exec rackup`.  Running this command will boot the server on port `9292` (and the CLI will inform you if this changed).  

This should only be used in development, as there is no security around this web interface, and you can delete everything.

### TLDR;

```bash
# install ruby
cd ./resque-web
gem install bundler
bundle install
bundle exec rackup
```

## Docker

# Docker image for Resque Web

## How to use

### Use as standalone container

You can use `docker run` to run this image directly.

```bash
docker run -p 9292:9292 -e REDIS_HOST=10.0.0.10 corbinu/resque-web
```

### Use Docker Compose

[Docker Compose](https://docs.docker.com/compose/) is the recommended way to run this image with Redis database.

A sample `docker-compose.yml` can be found in this repo.

```yaml
version: '2'

services:
  web:
    image: corbinu/node-resque-web
    ports:
      - "9292:9292"
    depends_on:
      - db
    env_file:
      - env

  db:
    image: redis:3-alpine
    ports:
      - "6379:6379"
    env_file:
      - env
    depends_on:
      - dbdata
    volumes_from:
      - dbdata

  dbdata:
    image: tianon/true
    volumes:
      - /data
```

Then use `docker-compose up -d` to start Resque Web server.

Configurations:

Environment variable      | Description | Default value (used by Docker Compose - `env` file)
--------------------      | ----------- | ---------------------------
REDIS_HOST                | Redis host  | redis
REDIS_PORT                | Redis port |  6379
REDIS_DB                  | Redis DB | 1
REDIS_NAMESPACE           | Redis namespace | none
AUTH_USERNAME             | Username for basic auth | none
AUTH_PASSWORD             | Password for basic auth | none

If Docker Compose is used, you can just modify `env` file in the same directory of `docker-compose.yml` file to update those environment variables.
