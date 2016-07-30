var specHelper = require(__dirname + '/../_specHelper.js').specHelper;
var should = require('should');

describe('plugins', function(){
  describe('custom plugins', function(){
    it('runs a custom plugin outside of the plugins directory', function(done){
      var jobs = {
        'myJob': {
          plugins: [require(__dirname + '/../custom-plugin.js')],
          perform: function(a, b, callback){
            done(new Error('should not run'));
          },
        },
      };

      var queue = new specHelper.NR.queue({connection: specHelper.cleanConnectionDetails(), queue: specHelper.queue}, jobs);
      queue.connect(function(){
        queue.enqueue(specHelper.queue, 'myJob', [1, 2], function(){
          queue.length(specHelper.queue, function(err, len){
            len.should.equal(0);
            queue.end(done);
          });
        });
      });
    });
  });

});
