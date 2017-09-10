// inspired by https://github.com/tj/node-blocked

module.exports = (limit, interval, fn) => {
  let start = process.hrtime()

  let timeout = setInterval(() => {
    let delta = process.hrtime(start)
    let nanosec = delta[0] * 1e9 + delta[1]
    let ms = nanosec / 1e6
    let n = ms - interval
    if (n > limit) {
      fn(true, Math.round(n))
    } else {
      fn(false, Math.round(n))
    }
    start = process.hrtime()
  }, interval)

  if (timeout.unref) { timeout.unref() }
}
