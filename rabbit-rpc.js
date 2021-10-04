var amqp = require('amqplib/callback_api');

module.exports = function (RED) {
    function RabbitRPCReq(config) {

        RED.nodes.createNode(this, config);
        var node = this;
        node.queueName = config.queueName;
        node.host = config.host;
        node.login = config.login;
        node.pass = config.pass;
        node.timeout = 30000;
        node.reconnect = true;
        node.on('close', function () {
            console.log("Connection closing due to restart");
            node.reconnect = false;
            node.amqpConn.close();
        })
        node.opt = { credentials: require('amqplib').credentials.plain(node.login, node.pass) };
        connectClient(node);

    }

    RED.nodes.registerType("rabbit-rpc-req", RabbitRPCReq);

    function RabbitRPCServer(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        node.timeout = 10000;
        // if the connection is closed or fails to be established at all, we will reconnect
        node.myId = Math.random();
        node.amqpConn = null;
        node.queueName = config.queueName;
        node.host = config.host;
        node.login = config.login;
        node.pass = config.pass;
        node.opt = { credentials: require('amqplib').credentials.plain(node.login, node.pass) };
        node.reconnect = true;
        node.on('close', function () {
            console.log("Connection closing due to restart");
            node.reconnect = false;
            node.amqpConn.close();
        })
        connectServer(node);

    }
    RED.nodes.registerType("rabbit-rpc-server", RabbitRPCServer);
}


function connectServer(node) {
    amqp.connect(`amqp://${node.host}`, node.opt, function (err, conn) {
        if (err) {
            console.error("[AMQP-server]", err.message);
            return setTimeout(function () { connectServer(node) }, node.timeout);
        }
        conn.on("error", function (err) {
            if (err.message !== "Connection closing") {
                console.error("[AMQP-server] conn error", err.message);
            }
        });
        conn.on("close", function () {
            if (node.reconnect) {
                console.error("[AMQP-server] reconnecting");
                return setTimeout(function () { connectServer(node) }, node.timeout);
            }
        });

        console.log("[AMQP-server] connected");
        node.amqpConn = conn;

        startListener(node);
    });
}

function startListener(node) {
    node.amqpConn.createChannel(function (err, channel) {
        if (closeOnErr(err)) return;
        channel.on("error", function (err) {
            console.error("[AMQP-server] channel error", err.message);
        });
        channel.on("close", function () {
            console.log("[AMQP-server] channel closed");
        });
        var queue = node.queueName;
        channel.assertQueue(queue, {
            //durable: false
        });
        channel.prefetch(1);
        console.log(' [x] Awaiting RPC requests');
        channel.consume(queue, function reply(rabbitMsg) {
            console.log(' [x] Got %s', rabbitMsg.content.toString());
            console.log(node.myId);

            let msg = {
                payload: rabbitMsg.content.toString(),
                replyTo: rabbitMsg.properties.replyTo,
                correlationId: rabbitMsg.properties.correlationId,
                nodeId: node.myId
            };
            node.send(msg)
            channel.ack(rabbitMsg);
        });

    });
}

function closeOnErr(err, node) {
    if (!err) return false;
    console.error("[AMQP-server] error", err);
    node.amqpConn.close();
    return true;
}

function generateUuid() {
    return Math.random().toString() +
        Math.random().toString() +
        Math.random().toString();
}
function connectClient(node) {
    amqp.connect(`amqp://${node.host}`, node.opt, function (err, conn) {
        if (err) {
            console.error("[AMQP-client]", err.message);
            return setTimeout(function () { connectClient(node) }, node.timeout);
        }
        conn.on("error", function (err) {
            if (err.message !== "Connection closing") {
                console.error("[AMQP-client] conn error", err.message);
            }
        });
        conn.on("close", function () {
            if (node.reconnect) {
                console.error("[AMQP-client] reconnecting");
                return setTimeout(function () { connectClient(node) }, node.timeout);
            }
        });

        console.log("[AMQP-client] connected");
        node.amqpConn = conn;
        startClient(node);
    });
}
function startClient(node) {
    node.on("input", async function (msg) {
        node.amqpConn.createChannel(function (err, channel) {
            if (closeOnErr(err)) {
                return
            };
            channel.on("error", function (err) {
                channel = null;
                console.error("[AMQP-client] channel error", err.message);
            });
            channel.on("close", function () {
                channel = null;
                console.log("[AMQP-client] channel closed");
            });
            var correlationId = msg.correlationId || generateUuid();
            var num = msg.payload;
            var queueName = node.queueName;
            var replyQueue;
            if (!msg.replyTo) {
                var timer = setTimeout(function () {
                    if (channel) {
                        try {
                            channel.deleteQueue(replyQueue, {ifEmpty:false});
                            channel.close();
                        } catch (e) {
                            node.error(e);
                        }
                        channel = null;
                        console.log("[AMQP-client] timeout");
                    }
                    //process.exit(0);
                }, 30000);
                channel.assertQueue('', {
                    exclusive: true
                }, function (error2, q) {
                    if (error2) {
                        node.error(error2);
                        return;
                    }
                    replyQueue = q.queue;
                    channel.consume(q.queue, function reply(rabbitMsg) {
                        console.log(' [.] Got %s', rabbitMsg.content.toString());
                        console.log(node.myId);
                        msg.payload = rabbitMsg.content.toString(),
                        msg.replyTo = rabbitMsg.properties.replyTo,
                        msg.correlationId = rabbitMsg.properties.correlationId,
                        //msg.nodeId: node.myId
                        node.send(msg)
                        clearTimeout(timer);
                        setTimeout(function () {
                            if (channel) {
                                try {
                                    channel.ack(rabbitMsg);
                                    channel.deleteQueue(replyQueue, {ifEmpty:false});
                                    channel.close();
                                } catch (e) {
                                    node.error(e);
                                }
                                console.log("[AMQP-client] done");
                                channel = null;
                            }
                            //process.exit(0);
                        }, 500);
                        return;
                    });
                    channel.sendToQueue(queueName,
                        Buffer.from(num.toString()), {
                        replyTo: q.queue,
                        correlationId: correlationId
                        //headers: headers
                    });
                    return;
                }, {
                    noAck: true,
                    consumerTag: correlationId
                });
                return;
            } else {
                channel.sendToQueue(msg.replyTo,
                    Buffer.from(num.toString()), {
                    correlationId: correlationId
                    //headers: headers
                });
                channel.close();
                return;
            }
        });
    });
}
