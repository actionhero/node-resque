var path = require('path')
var specHelper = require(path.join(__dirname, '..', '_specHelper.js')).specHelper
var should = require('should') // eslint-disable-line

describe('plugins', function () {
  describe('custom plugins', function () {
    it('runs a custom plugin outside of the plugins directory', function (done) {
      var jobs = {
        'myJob': {
          plugins: [require(path.join(__dirname, '..', 'custom-plugin.js'))],
          perform: function (a, b, callback) {
            done(new Error('should not run'))
          }
        }
      }

      var Queue = specHelper.NR.queue
      var queue = new Queue({connection: specHelper.cleanConnectionDetails(), queue: specHelper.queue}, jobs)
      queue.connect(function () {
        queue.enqueue(specHelper.queue, 'myJob', [1, 2], function () {
          queue.length(specHelper.queue, function (err, len) {
            should.not.exist(err)
            len.should.equal(0)
            queue.end(done)
          })
        })
      })
    })
  })
})
