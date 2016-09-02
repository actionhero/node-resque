// inspired by https://github.com/tj/node-blocked

module.exports = function(limit, interval, fn){
  var start = process.hrtime();

  var timeout = setInterval(function(){
    var delta = process.hrtime(start);
    var nanosec = delta[0] * 1e9 + delta[1];
    var ms = nanosec / 1e6;
    var n = ms - interval;
    if(n > limit){
      fn(true, Math.round(n));
    }else{
      fn(false, Math.round(n));
    }
    start = process.hrtime();
  }, interval);

  if(timeout.unref){
    timeout.unref();
  }
};
