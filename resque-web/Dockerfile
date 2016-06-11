FROM ruby:2-alpine
MAINTAINER 	Corbin Uselton <corbinu@decimal.io>

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

COPY Gemfile /usr/src/app/
COPY Gemfile.lock /usr/src/app/

RUN bundle install

COPY . /usr/src/app

CMD ["/bin/sh", "-c", "bundle exec rackup --host=0.0.0.0"]
