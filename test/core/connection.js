var specHelper = require(__dirname + '/../_specHelper.js').specHelper;
var should = require('should');

describe('connection', function(){

  before(function(done){
    specHelper.connect(function(){
      specHelper.cleanup(function(){
        done();
      });
    });
  });

  after(function(done){
    specHelper.cleanup(function(){
      done();
    });
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

    var connection = new specHelper.NR.connection(connectionDetails);
    connection.connect(function(){ throw new Error('should not get here'); });

    connection.on('error', function(error){
      error.message.should.match(/getaddrinfo ENOTFOUND/);
      connection.end();
      done();
    });
  });

  it('should stat with no redis keys in the namespace', function(done){
    specHelper.redis.keys(specHelper.namespace + '*', function(err, keys){
      keys.length.should.equal(0);
      done();
    });
  });

  it('will properly build namespace strings', function(done){
    var connection = new specHelper.NR.connection(specHelper.cleanConnectionDetails());
    connection.connect(function(){
      connection.key('thing').should.equal(specHelper.namespace + ':thing');
      connection.end();
      done();
    });
  });

});
