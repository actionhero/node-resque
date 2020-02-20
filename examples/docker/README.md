# node-resque docker example

This project contains well-crafted docker files that demonstrate how to use node-resque dockerized environment. This project also contains a docker-compose example which will run the `worker` and `producer` against a shared redis image.

## Things to note

- The node-resque applications not only start the workers and scheduler, but also handle signals to gracefully shut them down. If you don't do this, you are likely to loose job data and have "stuck" workers in your environment
  - See https://github.com/actionhero/node-resque/issues/319 and https://github.com/actionhero/node-resque/issues/312 for examples
- You should run many instances of the scheduler. In this example every worker node will also be a scuduler. We handle leader election for you
- The docker files themselves should be constructed in a way that will ensure signals will be passed from the OS to your node application. Do not use PM2, npm, yarn, etc to run your app... call it directly.
  - You can learn more here https://hynek.me/articles/docker-signals/

## To Run

```
docker-compose up
```

You will see output like:

```
node-resque-producer_1  | adding jobs @ Mon Feb 17 2020 04:12:42 GMT+0000 (Coordinated Universal Time)
node-resque-producer_1  | adding jobs @ Mon Feb 17 2020 04:12:43 GMT+0000 (Coordinated Universal Time)
node-resque-producer_1  | adding jobs @ Mon Feb 17 2020 04:12:44 GMT+0000 (Coordinated Universal Time)
node-resque-producer_1  | adding jobs @ Mon Feb 17 2020 04:12:45 GMT+0000 (Coordinated Universal Time)
node-resque-producer_1  | adding jobs @ Mon Feb 17 2020 04:12:46 GMT+0000 (Coordinated Universal Time)
node-resque-worker_1    | worker check in @ 1581912766
node-resque-worker_1    | scheduler became leader
node-resque-worker_1    | scheduler polling
node-resque-worker_1    | scheduler working timestamp 1581912700
node-resque-worker_1    | scheduler enqueuing job 1581912700 >> {"class":"subtract","queue":"math","args":[2,1]}
node-resque-worker_1    | worker polling math
node-resque-worker_1    | working job math {"class":"add","queue":"math","args":[1,2]}
node-resque-worker_1    | job success math {"class":"add","queue":"math","args":[1,2]} >> 3 (1ms)
node-resque-worker_1    | worker polling math
```

When you stop the cluster, you can then inspect the logs from your image to confirm that the shutdown behavior is what you expected:

```
docker logs -f {your image ID}

... (snip)

scheduler polling
scheduler working timestamp 1581912881
scheduler enqueuing job 1581912881 >> {"class":"subtract","queue":"math","args":[2,1]}
scheduler polling
[ SIGNAL ] - SIGTERM
scheduler ended
worker ended
processes gracefully stopped
```
