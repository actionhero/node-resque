-- { "numberOfKeys": 2 }

-- Keys:
--   1 - Queue Key
--   2 - Worker Key

-- Args
--   1 - Date
--   2 - Queue Name
--   3 - Worker Name

local payload = redis.call('lpop', KEYS[1])

if payload then
  local workerPayload = {}
  workerPayload['run_at'] = ARGV[1]
  workerPayload['queue'] = ARGV[2]
  workerPayload['payload'] = cjson.decode(payload)
  workerPayload['worker'] = ARGV[3]

  redis.call('set', KEYS[2], cjson.encode(workerPayload))
end

return payload
