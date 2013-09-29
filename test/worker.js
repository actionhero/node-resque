describe('worker', function(){

  var specHelper = require(__dirname + "/_specHelper.js").specHelper;
  var should = require('should');
  var worker;
  var queue;

  var jobs = {};
  
  before(function(done){
    specHelper.connect(function(){
      specHelper.cleanup(function(){
        queue = new specHelper.AR.queue({connection: specHelper.connectionDetails, queue: specHelper.queue}, function(){
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

  it("can connect", function(done){
    worker = new specHelper.AR.worker({connection: specHelper.connectionDetails, timeout: specHelper.timeout}, jobs, function(){
      should.exist(worker);
      done()
    });
  });

  it("can boot", function(done){
    worker.start();
    done()
  });

  it('can be stopped', function(done){
    this.timeout(specHelper.timeout * 3)
    worker.end(function(){
      done();
    });
  });

  it('can clear previously crashed workers from the same host')
  it('can work a job')
  it('will return job responses as events on success')
  it('will not work jobs that are not defined')
  it('will place failed jobs in the failed list')
  it('will catch exceptions within jobs and place the job in the failed list')

});