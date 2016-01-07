var specHelper = require(__dirname + "/../_specHelper.js").specHelper;
var should = require('should');

describe('plugins', function(){

  var jobs = {
    "brokenJob": {
      plugins: [ 'simpleRetry' ],
      pluginOptions: { simpleRetry: {
        retryInterval: [100]
      },},
      perform: function(a,b,callback){
        callback(new Error("BROKEN"), null);
      },
    }
  };

  before(function(done){
    specHelper.connect(function(){
      specHelper.cleanup(function(){
        queue = new specHelper.NR.queue({connection: specHelper.cleanConnectionDetails(), queue: specHelper.queue}, jobs);
        queue.connect(done);
      });
    });
  });

  afterEach(function(done){
    specHelper.cleanup(done);
  });

  describe('simpleRetry',function(){
    it('bad job should not crash with simpleRetry', function(done){
      queue.enqueue(specHelper.queue, "brokenJob", [1,2], function(){
        queue.length(specHelper.queue, function(err, len){
          len.should.equal(1);

          var worker = new specHelper.NR.worker({
            connection: specHelper.connectionDetails,
            timeout:    specHelper.timeout,
            queues:     specHelper.queue
          }, jobs);

          worker.connect(function(){
            worker.on('success', function(q, job, result){
              specHelper.queue.should.equal(q);
              queue.scheduledAt(specHelper.queue, "brokenJob", [1,2], function(err, timestamps){
                timestamps.length.should.be.equal(1);
                worker.end();
                done();
              });
            });

            worker.on('error', function(q, job, error){
              throw new Error('should not be here');
            });

            worker.start();
          });
        });
      });
    });

  });
});
