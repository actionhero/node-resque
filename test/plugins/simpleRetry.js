var specHelper = require(__dirname + "/../_specHelper.js").specHelper;
var should = require('should');

describe('plugins', function(){

  var errorCollector = [];
  var jobs = {
    "brokenJob": {
      plugins: [ 'simpleRetry' ],
      pluginOptions: { simpleRetry: {
        sleep: 100,
        errorCollector: errorCollector,
      },},
      perform: function(a,b,callback){
        callback(new Error("BROKEN"), null);
      },
    }
  };

  before(function(done){
    specHelper.connect(function(){
      specHelper.cleanup(function(){
        queue = new specHelper.NR.queue({connection: specHelper.connectionDetails, queue: specHelper.queue}, jobs, function(){
          done();
        });
      });
    });
  });

  afterEach(function(done){
    specHelper.cleanup(function(){
      done();
    });
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
          }, jobs, function(){

            worker.on('success', function(q, job, result){
              errorCollector.length.should.equal(1);
              String(errorCollector[0]).should.equal('Error: BROKEN');
              worker.end();
              done();
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