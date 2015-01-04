var specHelper = require(__dirname + "/../_specHelper.js").specHelper;
var should = require('should');

if(specHelper.package === 'fakeredis'){
  console.log("multiWorker does not work with fakeredis for now...")
}else{

  describe('multiWorker', function(){

    var queue, multiWorker;
    var checkTimeout = specHelper.timeout / 10;
    var minTaskProcessors = 1
    var maxTaskProcessors = 5

    var toDisconnectProcessors = true;

    var blockingSleep = function(naptime){
      var sleeping = true;
      var now = new Date();
      var alarm;
      var startingMSeconds = now.getTime();
      while(sleeping){
        alarm = new Date();
        var alarmMSeconds = alarm.getTime();
        if(alarmMSeconds - startingMSeconds > naptime){ sleeping = false }
      }
    }

    var jobs = {
      "slowSleepJob": {
        plugins: [],
        pluginOptions: {},
        perform: function(callback){
          setTimeout(function(){
            callback(null, new Date().getTime() );
          }, 1000);
        },
      },
      "slowCPUJob": {
        plugins: [],
        pluginOptions: {},
        perform: function(callback){
          blockingSleep(1000);
          callback(null, new Date().getTime() );
        },
      },
    };

    before(function(done){
      specHelper.connect(function(){
        queue = new specHelper.NR.queue({
          connection: specHelper.cleanConnectionDetails(), 
          queue: specHelper.queue
        }, function(){
          done();
        });
      });
    });

    before(function(done){
      multiWorker = new specHelper.NR.multiWorker({
        connection: specHelper.cleanConnectionDetails(), 
        timeout: specHelper.timeout,
        checkTimeout: checkTimeout,
        minTaskProcessors: minTaskProcessors,
        maxTaskProcessors: maxTaskProcessors,
        queue: specHelper.queue,
        toDisconnectProcessors: toDisconnectProcessors,
      }, jobs, function(err){
        should.not.exist(err);
        should.exist(multiWorker);
        multiWorker.end(done);
      });
    });

    afterEach(function(done){
      queue.delQueue(specHelper.queue, function(err){
        should.not.exist(err);
        done()
      });
    });

    it('should never have less than one worker', function(done){
      multiWorker.workers.length.should.equal(0);
      multiWorker.start(function(){
        setTimeout(function(){
          multiWorker.workers.length.should.equal(1);
          multiWorker.end(done);
        }, checkTimeout + 1);
      });
    });

    it('should stop adding workers when the max is hit & CPU utilization is low', function(done){
      this.timeout(10 * 1000);

      var i = 0;
      while(i < 100){
        queue.enqueue(specHelper.queue, 'slowSleepJob', []);
        i++;
      }

      multiWorker.start(function(){
        setTimeout(function(){
          multiWorker.workers.length.should.equal(maxTaskProcessors);
          multiWorker.end(done);
        }, checkTimeout * 30);
      });
    });

    it('should not add workers when CPU utilization is high', function(done){
      this.timeout(10 * 1000);

      var i = 0;
      while(i < 100){
        queue.enqueue(specHelper.queue, 'slowCPUJob', []);
        i++;
      }

      multiWorker.start(function(){
        setTimeout(function(){
          multiWorker.workers.length.should.equal(1);
          multiWorker.end(done);
        }, checkTimeout * 20);
      });
    });

    it('should pass on all worker emits to the instance of multiWorker', function(done){
      queue.enqueue(specHelper.queue, 'crazyJob', []);

      var listener = multiWorker.on('failure', function(workerId, queue, job, error){
        String(error).should.equal('Error: No job defined for class \'crazyJob\'');
        multiWorker.removeAllListeners('error');
        multiWorker.end(done);
      });

      multiWorker.start();
    });

  });
}