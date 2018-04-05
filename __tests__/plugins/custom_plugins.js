const path = require('path')
const specHelper = require(path.join(__dirname, '..', 'utils', 'specHelper.js'))
const NodeResque = require(path.join(__dirname, '..', '..', 'index.js'))

describe('plugins', () => {
  describe('custom plugins', () => {
    test('runs a custom plugin outside of the plugins directory', async () => {
      const jobs = {
        'myJob': {
          plugins: [ require(path.join(__dirname, '..', 'utils', 'custom-plugin.js')) ],
          perform: function (a, b, callback) {
            throw new Error('should not get here')
          }
        }
      }

      const queue = new NodeResque.Queue({connection: specHelper.cleanConnectionDetails(), queue: specHelper.queue}, jobs)

      await queue.connect()
      let enqueueResponse = await queue.enqueue(specHelper.queue, 'myJob', [1, 2])
      expect(enqueueResponse).toBe(false)
      let length = await queue.length(specHelper.queue)
      expect(length).toBe(0)
      await queue.end()
    })
  })
})