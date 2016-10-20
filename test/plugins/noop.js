var specHelper = require(__dirname + '/../_specHelper.js').specHelper;
var should = require('should');

describe('plugins', function(){
  describe('noop', function(){
    var queue;
    var scheduler;
    var loggedErrors = [];

    var jobs = {
      'brokenJob': {
        plugins: ['noop'],
        pluginOptions: {'noop': {
          logger: function(error){
            loggedErrors.push(error);
          }
        }},
        perform: function(a, b, callback){
          callback(new Error('BUSTED'), null);
        }
      },
      'happyJob': {
        plugins: ['noop'],
        pluginOptions: {'noop': {
          logger: function(error){
            loggedErrors.push(error);
          }
        }},
        perform: function(a, b, callback){
          callback(null, null);
        }
      }
    };

    before(function(done){
      specHelper.connect(function(){
        specHelper.cleanup(function(){
          queue = new specHelper.NR.queue({connection:
                    specHelper.cleanConnectionDetails(), queue: specHelper.queue}, jobs);
          scheduler = new specHelper.NR.scheduler({connection:
                    specHelper.cleanConnectionDetails(), timeout: specHelper.timeout});
          scheduler.connect(function(){
            scheduler.start();
            queue.connect(done);
          });
        });
      });
    });

    beforeEach(function(done){
      loggedErrors = [];
      done();
    });

    after(function(done){
      scheduler.end(done);
    });

    afterEach(function(done){
      specHelper.cleanup(done);
    });

    it('will work fine with non-crashing jobs', function(done){
      queue.enqueue(specHelper.queue, 'happyJob', [1, 2], function(){
        queue.length(specHelper.queue, function(err, length){
          length.should.equal(1);

          var worker = new specHelper.NR.worker({
            connection: specHelper.cleanConnectionDetails(),
            timeout:    specHelper.timeout,
            queues:     specHelper.queue
          }, jobs);

          var complete = function(){
            specHelper.redis.llen('resque_test:failed', function(error, length){
              length.should.equal(0);
              worker.end(done);
            });
          };

          worker.connect(function(){

            worker.on('success', function(){
              loggedErrors.length.should.equal(0);
              complete();
            });

            worker.on('failure', function(){
              throw new Error('should never get here');
            });

            worker.start();
          });
        });
      });
    });

    it('will prevent any failed jobs from ending in the failed queue', function(done){
      queue.enqueue(specHelper.queue, 'brokenJob', [1, 2], function(){
        queue.length(specHelper.queue, function(err, length){
          length.should.equal(1);

          var worker = new specHelper.NR.worker({
            connection: specHelper.cleanConnectionDetails(),
            timeout:    specHelper.timeout,
            queues:     specHelper.queue
          }, jobs);

          var complete = function(){

            specHelper.redis.llen('resque_test:failed', function(error, length){
              length.should.equal(0);
              worker.end(done);
            });
          };

          worker.connect(function(){

            worker.on('success', function(){
              loggedErrors.length.should.equal(1);
              complete();
            });

            worker.on('failure', function(){
              throw new Error('should never get here');
            });

            worker.start();
          });
        });
      });
    });

  });
});
