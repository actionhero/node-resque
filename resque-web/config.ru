require "bundler/setup"
Bundler.require(:default)
require 'sinatra'
require 'resque/server'

run Rack::URLMap.new \
  "/" => Resque::Server.new