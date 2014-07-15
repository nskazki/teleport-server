var SocketsController = require('../libs/SocketsController');
var PeersController = require('../libs/PeersController');
var ObjectsController = require('../libs/ObjectsController');

var Socket = require('socket.io-client');

var assert = require('assert');
var util = require('util');
var events = require('events');

var port = 8000;

function socketClose(socket) {
	socket.packet({
		"type": 1,
		"nsp": "/"
	});

	//some socket.io-client bug
	//if disabled 500 ms delay disconnect message 
	//not sended to server

	//this bug worked if before #close call #send method
	//if call #close method after !connect - all ok :)
	setTimeout(function() {
		socket.destroy();
		socket.onclose('io client disconnect');
	}, 500);
}

describe('SocketsController', function() {
	beforeEach(function() {
		port++;
	});

	it('#new - server emited ready', function(done) {
		var socketsController = new SocketsController(port);

		socketsController.on('serverReady', done);
		socketsController.on('serverError', done);
	});

	it('#new - server emited error', function(done) {
		var socketsController = new SocketsController(port - 1);

		socketsController.on('serverReady', function() {
			done(new Error('server init on used port'));
		});
		socketsController.on('serverError', function() {
			done();
		});
	});

	it('#close - two server, one port', function(done) {
		var socketsController = new SocketsController(port);
		socketsController.close();

		socketsController = new SocketsController(port);
		socketsController.on('serverReady', done);
		socketsController.on('serverError', done);
	});

	it('!socketConnection', function(done) {
		var socketsController = new SocketsController(port);
		var socket = new Socket('http://localhost:' + port);

		socketsController.on('socketConnection', function(id) {
			done();
		});
	});

	it('!socketMessage', function(done) {
		var socketsController = new SocketsController(port);
		var socket = new Socket('http://localhost:' + port);

		var messageToSend = {
			hello: 'world!'
		};
		socket.send(messageToSend);

		socketsController.on('socketMessage', function(id, message) {
			assert.deepEqual(message, messageToSend);
			done();
		});
	});

	it('!socketDisconnect', function(done) {
		var socketsController = new SocketsController(port);

		socketsController.on('serverReady', function() {
			var socket = new Socket('http://localhost:' + port);
			socket.on('connect', function() {
				socket.disconnect();
			});
		});

		socketsController.on('socketDisconnect', function(id) {
			done();
		});
	});

	it('!socketDisconnect x2', function(done) {
		var socketsController = new SocketsController(port);

		socketsController.on('serverReady', function() {
			var socket = new Socket('http://localhost:' + port);


			socket.on('connect', function() {
				socket.send('some test');
			});

			socketsController.on('socketMessage', function(id, message) {
				assert.equal(message, 'some test');

				socketClose(socket);
			});

		});

		socketsController.on('socketDisconnect', function(id) {
			done();
		});
	});

	it('~needSocketSend', function(done) {
		var socketsController = new SocketsController(port);
		var socket = new Socket('http://localhost:' + port);

		var peersController = new events.EventEmitter();
		socketsController.up(peersController);

		socketsController.on('socketConnection', function(id) {
			socket.on('message', function(message) {
				assert.equal(message, 'hello');

				done();
			});

			peersController.emit('needSocketSend', id, 'hello');
		})
	})
});

describe('PeersController', function() {
	beforeEach(function() {
		port++;
	});

	it('#new', function() {
		var peersController = new PeersController();
	})

	it('#down', function() {
		var socketsController = new SocketsController(port);
		var peersController = new PeersController().down(socketsController);
	});

	it('!peerConnection', function(done) {
		var socketsController = new SocketsController(port);
		var peersController = new PeersController().down(socketsController);
		socketsController.up(peersController);

		var socket = new Socket('ws://localhost:' + port);
		socket.send({
			type: 'internalCommand',
			internalCommand: 'connect',
			args: {
				clientTimestamp: new Date().valueOf()
			}
		});

		peersController.on('peerConnection', function(id) {
			assert.equal(id,0);

			done();
		});
	});

	it('!peerDisconnectedTimeout', function(done) {
		var socketsController = new SocketsController(port);
		var peersController = new PeersController().down(socketsController);
		var socket = new Socket('ws://localhost:' + port);

		socket.send({
			type: 'internalCommand',
			internalCommand: 'connect',
			args: {
				clientTimestamp: new Date().valueOf()
			}
		});

		peersController.on('peerConnection', function(id) {
			assert.equal(id,0);

			socketClose(socket);
		});

		peersController.on('peerDisconnectedTimeout', function(id) {
			assert.equal(id,0);

			done();
		});
	});

	it('!peerDisconnectedTimeout && fail reconnect atempt', function(done) {
		var socketsController = new SocketsController(port);
		var peersController = new PeersController().down(socketsController);
		socketsController.up(peersController);

		var socket = new Socket('ws://localhost:' + port);
		var clientTimestamp = new Date().valueOf();

		socket.send({
			type: 'internalCommand',
			internalCommand: 'connect',
			args: {
				clientTimestamp: clientTimestamp
			}
		});

		peersController.on('peerConnection', function(id) {
			assert.equal(id,0);

			socketClose(socket);
		});

		peersController.on('peerDisconnectedTimeout', function(id) {
			assert.equal(id,0);

			var socket = new Socket('ws://localhost:' + port, {
				forceNew: true
			});

			socket.send({
				type: 'internalCommand',
				internalCommand: 'reconnect',
				args: {
					clientTimestamp: clientTimestamp,
					peerId: id
				}
			});

			socket.on('message', function(message) {
				if (message.error) done();
			})
		});
	});

	it('~needPeerSend', function(done) {
		var socketsController = new SocketsController(port);
		var peersController = new PeersController();
		var objectsController = new events.EventEmitter();

		socketsController.up(peersController);
		peersController.down(socketsController).up(objectsController);

		var socket = new Socket('http://localhost:' + port);
		socket.send({
			type: 'internalCommand',
			internalCommand: 'connect',
			args: {
				clientTimestamp: new Date().valueOf()
			}
		});

		peersController.on('peerConnection', function(id) {
			assert.equal(id,0);

			socket.on('message', function(message) {
				if (message == 'hello') done();
			});

			objectsController.emit('needPeerSend', id, 'hello');
		})
	});

	it('!peerReconnect', function(done) {
		var socketsController = new SocketsController(port);
		var peersController = new PeersController().down(socketsController);
		socketsController.up(peersController);

		var socket = new Socket('ws://localhost:' + port);
		var clientTimestamp = new Date().valueOf();

		socket.send({
			type: 'internalCommand',
			internalCommand: 'connect',
			args: {
				clientTimestamp: clientTimestamp
			}
		});

		var count = [];

		peersController.on('peerConnection', function(id) {
			assert.equal(id,0);

			socketClose(socket);
		});

		peersController.on('peerDisconnect', function(id) {
			assert.equal(id,0);

			var socket = new Socket('ws://localhost:' + port, {
				forceNew: true
			});

			socket.send({
				type: 'internalCommand',
				internalCommand: 'reconnect',
				args: {
					clientTimestamp: clientTimestamp,
					peerId: id
				}
			});

			socket.on('message', function(message) {
				assert.deepEqual(message, {
					type: 'internalCallback',
					internalCommand: 'reconnect',
					error: null,
					result: 'reconnected!'
				})

				count.push('message');
				if (count.length == 2) done();
			})
		});

		peersController.on('peerReconnect', function(id) {
			assert.equal(id, 0);

			count.push('peerReconnect');
			if (count.length == 2) done();
		});
	});

	it('~needPeerSend, while peer disconnected', function(done) {
		var socketsController = new SocketsController(port);
		var peersController = new PeersController();
		var objectsController = new events.EventEmitter();

		var clientTimestamp = new Date().valueOf();

		socketsController.up(peersController);
		peersController.down(socketsController).up(objectsController);

		var socket = new Socket('http://localhost:' + port);
		socket.send({
			type: 'internalCommand',
			internalCommand: 'connect',
			args: {
				clientTimestamp: clientTimestamp
			}
		});

		var count = [];

		peersController.on('peerConnection', function(id) {
			assert.equal(id, 0);

			socketClose(socket);
		});

		peersController.on('peerDisconnect', function(id) {
			assert.equal(id, 0);

			objectsController.emit('needPeerSend', id, 'hello :)');

			var socket = new Socket('ws://localhost:' + port, {
				forceNew: true
			});

			socket.send({
				type: 'internalCommand',
				internalCommand: 'reconnect',
				args: {
					clientTimestamp: clientTimestamp,
					peerId: id
				}
			});

			var messageCount = 0;
			socket.on('message', function(message) {
				messageCount++;
				if (messageCount === 2) assert.deepEqual(message, 'hello :)');

				count.push('message');
				if (count.length == 3) done();
			})
		});

		peersController.on('peerReconnect', function(id) {
			assert.equal(id, 0);

			count.push('peerReconnect');
			if (count.length == 3) done();
		});
	});

	it('~needPeersBroadcastSend', function(done) {
		var socketsController = new SocketsController(port);
		var peersController = new PeersController();
		var objectsController = new events.EventEmitter();

		socketsController.up(peersController);
		peersController.down(socketsController).up(objectsController);

		var socket = new Socket('http://localhost:' + port);
		socket.send({
			type: 'internalCommand',
			internalCommand: 'connect',
			args: {
				clientTimestamp: new Date().valueOf()
			}
		});

		peersController.on('peerConnection', function(id) {
			assert.equal(id, 0);

			socket.on('message', function(message) {
				assert.equal(message, 'hello');
				done();
			});

			objectsController.emit('needPeersBroadcastSend', 'hello');
		})
	});



	it('!peerDisconnect', function(done) {
		var socketsController = new SocketsController(port);
		var peersController = new PeersController().down(socketsController);
		var socket = new Socket('ws://localhost:' + port);

		socket.on('connect', function() {
			socket.send({
				type: 'internalCommand',
				internalCommand: 'connect',
				args: {
					clientTimestamp: new Date().valueOf()
				}
			});
		});

		peersController.on('peerConnection', function(peerId) {
			assert.equal(peerId, 0);
			socketClose(socket);
		});
		peersController.on('peerDisconnect', function(peerId) {
			assert.equal(peerId, 0);
			done();
		})
	});
});

describe('ObjectsController', function() {
	beforeEach(function() {
		port++;
	});

	it('#new', function() {
		var objectsController = new ObjectsController({
			'blank': {
				object: new ClassWithFuncAndEvents(),
				methods: ['simpleFunc'],
				events: ['simpleEvent']
			}
		});
	});

	it('~needObjectsSend', function(done) {
		var objectsController = new ObjectsController({
			'blank': {
				object: new ClassWithFuncAndEvents(),
				methods: ['simpleFunc'],
				events: ['simpleEvent']
			}
		});
		var socketsController = new SocketsController(port);
		var peersController = new PeersController();

		socketsController.up(peersController);
		peersController.down(socketsController).up(objectsController);
		objectsController.down(peersController);

		var socket = new Socket('http://localhost:' + port);
		socket.send({
			type: 'internalCommand',
			internalCommand: 'connect',
			args: {
				clientTimestamp: new Date().valueOf()
			}
		});

		socket.on('message', function(message) {
			assert.deepEqual({
				type: "internalCallback",
				internalCommand: "connect",
				error: null,
				result: {
					blank: {
						methods: ['simpleFunc'],
						events: ['simpleEvent']
					}
				}
			}, message);

			done();
		});
	})

	it('!needPeersBroadcastSend', function(done) {
		var objWithFuncAndEvents = new ClassWithFuncAndEvents();

		var objectsController = new ObjectsController({
			'blank': {
				object: objWithFuncAndEvents,
				methods: ['simpleFunc'],
				events: ['simpleEvent']
			}
		});
		var socketsController = new SocketsController(port);
		var peersController = new PeersController();

		socketsController.up(peersController);
		peersController.down(socketsController).up(objectsController);
		objectsController.down(peersController);

		var socket = new Socket('http://localhost:' + port);
		socket.send({
			type: 'internalCommand',
			internalCommand: 'connect',
			args: {
				clientTimestamp: new Date().valueOf()
			}
		});

		var count = 0;;
		socket.on('message', function(message) {
			count++;

			if (count === 1) objWithFuncAndEvents.emit('simpleEvent', 'one', 2, '10');
			if (count === 2) assert.deepEqual(message, {
				type: 'event',
				objectName: 'blank',
				eventName: 'simpleEvent',
				args: ['one', 2, '10']
			});
			if (count === 2) done();
		});
	});

	it('!peerMessage', function(done) {
		var objectsController = new ObjectsController({
			'blank': {
				object: new ClassWithFuncAndEvents(),
				methods: ['simpleFunc'],
				events: ['simpleEvent']
			}
		});
		var socketsController = new SocketsController(port);
		var peersController = new PeersController();

		socketsController.up(peersController);
		peersController.down(socketsController).up(objectsController);
		objectsController.down(peersController);

		var socket = new Socket('http://localhost:' + port);
		socket.send({
			type: 'internalCommand',
			internalCommand: 'connect',
			args: {
				clientTimestamp: new Date().valueOf()
			}
		});

		socket.send({
			type: 'command',
			objectName: 'blank',
			methodName: 'simpleFunc',
			args: ['some arg'],
			requestId: 0
		});

		var count = 0;;
		socket.on('message', function(message) {
			count++;

			if (count === 2) assert.deepEqual(message, {
				type: 'callback',
				objectName: 'blank',
				methodName: 'simpleFunc',
				requestId: 0,
				error: null,
				result: 'some arg'
			});
			if (count === 2) done();
		});
	});
})

//
util.inherits(ClassWithFuncAndEvents, events.EventEmitter);

function ClassWithFuncAndEvents() {}

ClassWithFuncAndEvents.prototype.simpleFunc = function(arg, callback) {
	callback(null, arg);
};