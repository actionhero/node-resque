const EventEmitter = require('events').EventEmitter

class Connection extends EventEmitter {
  constructor (options) {
    super()

    const defaults = {
      pkg: 'ioredis',
      host: '127.0.0.1',
      port: 6379,
      database: 0,
      namespace: 'resque'
    }

    if (!options) { options = {} }
    for (let i in defaults) {
      if (options[i] === null || options[i] === undefined) {
        options[i] = defaults[i]
      }
    }

    this.options = options
    this.listeners = {}
    this.connected = false
  }

  async connect () {
    if (this.options.redis) {
      this.redis = this.options.redis
      try {
        await this.redis.set(this.key('connection_test_key'), 'ok')
        let data = await this.redis.get(this.key('connection_test_key'))
        if (data !== 'ok') { throw new Error('cannot read connection test key') }
        this.connected = true
      } catch (error) {
        this.connected = false
        this.emit('error', error)
      }
    } else {
      const pkg = require(this.options.pkg)
      this.redis = pkg.createClient(this.options.port, this.options.host, this.options.options)

      this.listeners.connect = async () => {
        if (this.connected === true) {
          // nothing to do here; this is a reconnect
        } else {
          try {
            await this.redis.select(this.options.database)
            this.connected = true
          } catch (error) {
            this.connected = false
            this.emit('error', error)
          }
        }
      }

      this.redis.on('connect', this.listeners.connect)
    }

    this.listeners.error = (error) => { this.emit('error', error) }
    this.redis.on('error', this.listeners.error)

    this.listeners.end = () => { this.connected = false }
    this.redis.on('end', this.listeners.end)
  }

  end () {
    this.connected = false

    Object.keys(this.listeners).forEach((eventName) => {
      this.redis.removeListener(eventName, this.listeners[eventName])
    })

    // Only disconnect if we established the redis connection on our own.
    if (!this.options.redis) {
      if (typeof this.redis.disconnect === 'function') { this.redis.disconnect() } else { this.redis.quit() }
    }
  }

  key () {
    let args
    args = (arguments.length >= 1 ? [].slice.call(arguments, 0) : [])
    args.unshift(this.options.namespace)
    args = args.filter((e) => { return String(e).trim() })
    return args.join(':')
  }
}

exports.Connection = Connection
