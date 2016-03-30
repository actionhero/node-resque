.PHONY: test

test:
	redis-cli flushall && FAKEREDIS=false npm test
