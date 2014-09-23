require "bundler/setup"
Bundler.require(:default)
require 'sinatra'
require 'resque/server'
require 'resque/scheduler'
require 'resque/scheduler/server'
require 'yaml'

Resque.redis = Redis.new

# Or, with custom options
# Resque.redis = Redis.new({
#   :host => "127.0.0.1", 
#   :port => 6390, 
#   :db => 1
# })

run Rack::URLMap.new \
  "/" => Resque::Server.new
