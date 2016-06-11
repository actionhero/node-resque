require "bundler/setup"
Bundler.require(:default)
require 'sinatra'
require 'resque/server'
require 'resque/scheduler'
require 'resque/scheduler/server'
require 'resque-retry'
require 'resque-retry/server'
require 'yaml'

redis_host = ENV['REDIS_HOST']
redis_port = ENV['REDIS_PORT']
redis_db = ENV['REDIS_DB']
redis_namespace = ENV['REDIS_NAMESPACE']
AUTH_USERNAME = ENV['AUTH_USERNAME']
AUTH_PASSWORD = ENV['AUTH_PASSWORD']

redis_host ||= "redis"
redis_port ||=  6379
redis_db ||=  1

Resque.redis = Redis.new({
  :host => redis_host,
  :port => redis_port,
  :db => redis_db,
})

connecting = "Connecting to redis db #{redis_db} on #{redis_host}:#{redis_port}"

if (defined?(redis_namespace))
  connecting << " with namespace #{redis_namespace}"
  Resque.redis.namespace = redis_namespace
end

if AUTH_PASSWORD
  Resque::Server.use Rack::Auth::Basic do |username, password|
    username == AUTH_USERNAME && password == AUTH_PASSWORD
  end
end

puts connecting

run Rack::URLMap.new \
  "/" => Resque::Server.new