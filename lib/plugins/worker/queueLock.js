// If a job with the same queue, name, and args is already in this queue, don't enqueue it again

var queueLock = {
  
}

exports.queueLock = queueLock;