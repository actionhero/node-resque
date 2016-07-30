var specHelper = require(__dirname + '/../_specHelper.js').specHelper;
var should = require('should');

describe('scheduler', function(){

  var scheduler;
  var queue;

  it('can connect', function(done){
    scheduler = new specHelper.NR.scheduler({connection: specHelper.connectionDetails, timeout: specHelper.timeout});
    scheduler.connect(function(){
      should.exist(scheduler);
      done();
    });
  });

  it('can provide an error if connection does not establish for a long period', function(done){
    var connectionDetails = {
      pkg:       specHelper.connectionDetails.pkg,
      host:      'wronghostname',
      password:  specHelper.connectionDetails.password,
      port:      specHelper.connectionDetails.port,
      database:  specHelper.connectionDetails.database,
      namespace: specHelper.connectionDetails.namespace,
    };

    scheduler = new specHelper.NR.scheduler({connection: connectionDetails, timeout: specHelper.timeout});
    scheduler.queue.connect = function(callback){
      setTimeout(function(){
        callback(new Error('Cannot connect'));
      }, 1000);
    };

    scheduler.connect();

    scheduler.start();

    scheduler.on('poll', function(){
      throw new Error('Should not emit poll');
    });

    scheduler.on('master', function(){
      throw new Error('Should not emit master');
    });

    setTimeout(done, 2000);
  });

  it('can provide an error if connection failed', function(done){
    // Only run this test if this is using real redis
    if(process.env.FAKEREDIS === 'true' || process.env.FAKEREDIS === true){
      return done();
    }

    var connectionDetails = {
      pkg:       specHelper.connectionDetails.pkg,
      host:      'wronghostname',
      password:  specHelper.connectionDetails.password,
      port:      specHelper.connectionDetails.port,
      database:  specHelper.connectionDetails.database,
      namespace: specHelper.connectionDetails.namespace,
    };

    scheduler = new specHelper.NR.scheduler({connection: connectionDetails, timeout: specHelper.timeout});
    scheduler.connect(function(){
      throw new Error('should not get here');
    });

    scheduler.on('error', function(error){
      error.message.should.match(/getaddrinfo ENOTFOUND/);
      scheduler.end();
      done();
    });
  });

  describe('locking', function(){
    before(function(done){ specHelper.connect(done); });
    beforeEach(function(done){ specHelper.cleanup(done); });
    after(function(done){ specHelper.cleanup(done); });

    it('should only have one master; and can failover', function(done){
      var sheduler_1 = new specHelper.NR.scheduler({connection: specHelper.connectionDetails, name: 'scheduler_1', timeout: specHelper.timeout});
      var sheduler_2 = new specHelper.NR.scheduler({connection: specHelper.connectionDetails, name: 'scheduler_2', timeout: specHelper.timeout});

      sheduler_1.connect();
      sheduler_2.connect();

      sheduler_1.start();
      sheduler_2.start();

      setTimeout(function(){
        sheduler_1.master.should.equal(true);
        sheduler_2.master.should.equal(false);
        sheduler_1.end();
        setTimeout(function(){
          sheduler_1.master.should.equal(false);
          sheduler_2.master.should.equal(true);
          sheduler_2.end(function(){ done(); });
        }, (specHelper.timeout * 2));
      }, (specHelper.timeout * 2));
    });
  });

  describe('[with connection]', function(){
    before(function(done){
      specHelper.connect(done);
    });

    beforeEach(function(done){
      specHelper.cleanup(function(){
        scheduler = new specHelper.NR.scheduler({connection: specHelper.connectionDetails, timeout: specHelper.timeout});
        queue = new specHelper.NR.queue({connection: specHelper.connectionDetails, queue: specHelper.queue});
        scheduler.connect(function(){
          queue.connect(function(){
            done();
          });
        });
      });
    });

    after(function(done){ specHelper.cleanup(done); });

    it('can boot', function(done){
      scheduler.start();
      done();
    });

    it('can be stopped', function(done){
      this.timeout(specHelper.timeout * 3);
      scheduler.end(function(){
        done();
      });
    });

    it('will move enqueued jobs when the time comes', function(done){
      queue.enqueueAt(1000 * 10, specHelper.queue, 'someJob', [1, 2, 3], function(){
        scheduler.poll(function(){
          specHelper.popFromQueue(function(err, obj){
            should.exist(obj);
            obj = JSON.parse(obj);
            obj['class'].should.equal('someJob');
            obj.args.should.eql([1, 2, 3]);
            done();
          });
        });
      });
    });

    it('will not move jobs in the future', function(done){
      queue.enqueueAt((new Date().getTime() + 10000),  specHelper.queue, 'someJob', [1, 2, 3], function(){
        scheduler.poll(function(){
          specHelper.popFromQueue(function(err, obj){
            should.not.exist(obj);
            done();
          });
        });
      });
    });
  });

});
