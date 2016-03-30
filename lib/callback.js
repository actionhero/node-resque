'use strict';

module.exports = function(callback) {
  if (typeof callback === 'function') {
    return callback;
  } else {
    return function() {};
  }
}
