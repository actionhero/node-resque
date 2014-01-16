var specHelper = require(__dirname + "/../_specHelper.js").specHelper;
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

  it("should stat with no redis keys in the namespace", function(done){
    specHelper.redis.keys(specHelper.namespace + "*", function(err, keys){
      keys.length.should.equal(0);
      done();
    });
  });

  it("will properly build namespace strings", function(done){
    var connection = new specHelper.NR.connection(specHelper.connectionDetails);
    connection.connect(function(){
      connection.key("thing").should.equal(specHelper.namespace + ":thing");
      done();
    });    
  });

});