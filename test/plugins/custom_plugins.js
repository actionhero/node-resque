var specHelper = require(__dirname + "/../_specHelper.js").specHelper;
var should = require('should');

describe('plugins', function(){

  var jobDelay = 100;

  var jobs = {
    "slowAdd": {
      plugins: [ 'jobLock' ],
      pluginOptions: { jobLock: {}, },
      perform: function(a,b,callback){
        var answer = a + b;
        setTimeout(function(){
          callback(null, answer);
        }, jobDelay);
      },
    },
    "uniqueJob": {
      plugins: [ 'queueLock', 'delayQueueLock' ],
      pluginOptions: { queueLock: {}, delayQueueLock: {} },
      perform: function(a,b,callback){
        var answer = a + b;
        callback(null, answer);
      },
    }
  };

  before(function(done){
    specHelper.connect(function(){
      specHelper.cleanup(function(){
        queue = new specHelper.NR.queue({connection: specHelper.cleanConnectionDetails(), queue: specHelper.queue}, jobs, function(){
          done();
        });
      });
    });
  });

  after(function(done){
    specHelper.cleanup(function(){
      done();
    });
  });

  describe('custom plugins', function(){
    it('runs a custom plugin outside of the plugins directory', function(done){
      var jobs = {
        "myJob": {
          plugins: [ require(__dirname + '/../custom-plugin.js') ],
          perform: function(a,b,callback){
            done(new Error('should not run'));
          },
        },
      };
      var queue = new specHelper.NR.queue({connection: specHelper.cleanConnectionDetails(), queue: specHelper.queue}, jobs, function(){
        queue.enqueue(specHelper.queue, "myJob", [1,2], function(){
          queue.length(specHelper.queue, function (err, len) {
            len.should.equal(0);
            done();
          });
        });
      });
    });
  });

});