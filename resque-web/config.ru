require "bundler/setup"
Bundler.require(:default)
require 'sinatra'
require 'resque/server'
require 'resque_scheduler'
require 'resque_scheduler/server'

run Rack::URLMap.new \
  "/" => Resque::Server.new