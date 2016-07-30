exports.connection     = require(__dirname + '/lib/connection.js').connection;
exports.queue          = require(__dirname + '/lib/queue.js').queue;
exports.worker         = require(__dirname + '/lib/worker.js').worker;
exports.multiWorker    = require(__dirname + '/lib/multiWorker.js').multiWorker;
exports.scheduler      = require(__dirname + '/lib/scheduler.js').scheduler;
exports.pluginRunner   = require(__dirname + '/lib/pluginRunner.js');
