require "bundler/setup"
Bundler.require(:default)
require 'sinatra'
require 'resque/server'
require 'resque/scheduler'
require 'resque/scheduler/server'
require 'resque-retry'
require 'resque-retry/server'
require 'yaml'

Resque.redis = Redis.new

# Or, with custom options
# Resque.redis = Redis.new({
#   :host => "127.0.0.1",
#   :port => 6379,
#   :db => 1,
# })
# Resque.redis.namespace = 'resque_test'

run Rack::URLMap.new \
  "/" => Resque::Server.new
