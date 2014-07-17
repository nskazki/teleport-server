'use stricts';

/*
	Events:
	
		peerReconnection
		peerConnection
		peerDisconnection
		peerMessage
		peerDisconnectedTimeout

		needSocketSend
		needObjectsSend

		peersControllerDestroyed
		peersControllerAlreadyDestroyed

	Listenings:
	
		up:
			needPeerSend
			needPeersBroadcastSend
	
		down:

			socketMessage
			socketDisconnection
*/

var util = require('util');
var events = require('events');
var jjv = require('jjv')();
var debug = require('debug')('TeleportServer:PeersController');

module.exports = PeersController;

util.inherits(PeersController, events.EventEmitter);

function PeersController(peerDisconnectedTimeout) {
	this._socketToPeerMap = {};
	this._peerList = {};
	this._peerDisconnectedTimeout = peerDisconnectedTimeout;

	this._lastPeerId = 0;

	this._selfBind();
	this._initAsyncEmit();

	this._isInit = true;
}

PeersController.prototype.destroy = function() {
	if (this._isInit === true) {
		this._isInit = false;

		for (var peerId in this._peerList) {
			if (this._peerList.hasOwnProperty(peerId)) {
				var peer = this._peerList[peerId];
				peer.destroy().removeAllListeners();
			}
		}

		this.emit('peersControllerDestroyed');
	} else {
		this.emit('peersControllerAlreadyDestroyed');
	}

	return this;
}

PeersController.prototype._initAsyncEmit = function() {
	var vanullaEmit = this.emit;
	this.emit = function() {
		var asyncArguments = arguments;

		process.nextTick(function() {
			vanullaEmit.apply(this, asyncArguments);
		}.bind(this));
	}.bind(this);
}

PeersController.prototype._selfBind = function() {
	this.on('peerDisconnection', function(peerId) {
		var peer = this._peerList[peerId];

		delete this._socketToPeerMap[peer._socketId];
		peer.disconnect();
	}.bind(this));

	this.on('needPeerSend', this._onNeedPeerSend.bind(this));

	this.on('peerReconnection', function(peerId) {
		var peer = this._peerList[peerId];

		while (peer._messageQueue.length) {
			var message = peer._messageQueue.shift();
			this.emit('needPeerSend', peerId, message);
		}
	}.bind(this));
};

PeersController.prototype._onNeedPeerSend = function(peerId, message) {
	var peer = this._peerList[peerId];
	if (!peer) return debug('peers, id: %s - ~needPeerSend, peer not found, message: %j', peerId, message);

	if (peer._socketId) {
		debug('peers, id: %s - ~needPeerSend, message: %j', peerId, message);
		this.emit('needSocketSend', peer._socketId, message);
	} else {
		debug('peers, id: %s - ~needPeerSend - send it later, message: %j', peerId, message);
		peer._messageQueue.push(message);
	}
};

PeersController.prototype.up = function(objectsController) {
	objectsController.on('needPeerSend', this._onNeedPeerSend.bind(this));

	objectsController.on('needPeersBroadcastSend', function(message) {
		debug('peers, id: all - ~needPeersBroadcastSend, message: %j', message);

		for (var peerId in this._peerList) {
			if (this._peerList.hasOwnProperty(peerId) && this._peerList[peerId]) {
				this.emit('needPeerSend', peerId, message);
			}
		}
	}.bind(this));

	return this;
}

PeersController.prototype.down = function(socketsController) {
	socketsController.on('socketMessage', function(socketId, message) {
		if (!this._findPeer(socketId)) {
			debug('peers, withoutId - #_peerAuth, socketId: %s, messager: %j', socketId, message);

			this._peerAuth(socketId, message);
		} else {
			var peerId = this._findPeerId(socketId);
			debug('peers, id: %s - !peerMessage: %j', peerId, message);

			this.emit('peerMessage', peerId, message);
		}
	}.bind(this));

	socketsController.on('socketDisconnection', function(socketId) {
		if (this._findPeer(socketId)) {
			var peerId = this._findPeerId(socketId);

			debug('peers, id: %s - !peerDisconnection.', peerId);
			this.emit('peerDisconnection', peerId);
		}
	}.bind(this));

	return this;
}

PeersController.prototype._findPeer = function(socketId) {
	var peerId = this._findPeerId(socketId);
	var peer = this._peerList[peerId];

	return peer;
}

PeersController.prototype._findPeerId = function(socketId) {
	return this._socketToPeerMap[socketId];
}

PeersController.prototype._peerAuth = function(socketId, message) {
	if (jjv.test('connect', message)) {
		this._peerConnect(socketId, message);
	} else if (jjv.test('reconnect', message)) {
		this._peerReconnect(socketId, message);
	}
}

PeersController.prototype._peerConnect = function(socketId, message, isAlreadyConnected) {
	var peerId = this._lastPeerId++;
	var clientTimestamp = message.args.clientTimestamp;

	var peer = new Peer(socketId, peerId, clientTimestamp, this._peerDisconnectedTimeout)
		.on('timeout', function() {
			delete this._peerList[peerId];
			peer.destroy().removeAllListeners();

			debug('peers, id: %s - !peerDisconnectedTimeout.', peerId);
			this.emit('peerDisconnectedTimeout', peerId);
		}.bind(this));

	this._socketToPeerMap[socketId] = peerId;
	this._peerList[peerId] = peer;

	debug('peers, id: %s - !needObjectsSend.', peerId);
	debug('peers, id: %s - !peerConnection.', peerId);


	// one message in - one message out
	// objectsController listenings ~needObjectsSend and emitted
	// !needPeerSend with objects props and new peerId
	if (isAlreadyConnected === true) {
		this.emit('needSocketSend', socketId, {
			type: 'internalCallback',
			internalCommand: 'reconnect',
			error: null,
			result: {
				newPeerId: peerId
			}
		});
	} else {
		this.emit('needObjectsSend', peerId);
		this.emit('peerConnection', peerId);
	}
}

PeersController.prototype._peerReconnect = function(socketId, message) {
	var peerId = message.args.peerId;
	var clientTimestamp = message.args.clientTimestamp;

	debug('peers, id: %s - #_peerReconnect.', peerId);

	var peer = this._peerList[peerId];
	if (peer && (peer._clientTimestamp == clientTimestamp)) {
		peer.reconnect(socketId);

		this.emit('needSocketSend', socketId, {
			type: 'internalCallback',
			internalCommand: 'reconnect',
			error: null,
			result: 'reconnected!'
		});

		this._socketToPeerMap[socketId] = peerId;

		debug('peers, id: %s - !peerReconnection.', peerId);

		return this.emit('peerReconnection', peerId);
	} else {
		debug('peers, id: %s - disconnected timeout, call #_peerConnect socketId: %s, message: %j', peerId, socketId, message);
		this._peerConnect(socketId, message, true);
	}
}

//Peer

util.inherits(Peer, events.EventEmitter);

function Peer(socketId, peerId, clientTimestamp, peerDisconnectedTimeout) {
	this._peerId = peerId;
	this._socketId = socketId;
	this._clientTimestamp = clientTimestamp;
	this._peerDisconnectedTimeout = peerDisconnectedTimeout;
	this._timeoutId = null;
	this._messageQueue = [];
	this._oldSocketId = null;
}

Peer.prototype.disconnect = function() {
	debug('peer, peerId: %s, socketId:  %s - #disconnect.', this._peerId, this._socketId);

	this._oldSocketId = this._socketId;
	this._socketId = null;

	this._timeoutId = setTimeout(function() {
		debug('peer, peerId: %s, oldSocketId:  %s - !timeout, peerDisconnectedTimeout: %d.',
			this._peerId, this._oldSocketId, this._peerDisconnectedTimeout);

		this.emit('timeout', this._peerId);
	}.bind(this), this._peerDisconnectedTimeout);

	return this;
}

Peer.prototype.reconnect = function(socketId) {
	debug('peer, id: %s, oldSocketId: %s - #reconnect, newSocketId: %s.',
		this._peerId, this._oldSocketId, socketId);

	if (this._timeoutId) {
		clearTimeout(this._timeoutId);
		this._timeoutId = null;
	}

	this._socketId = socketId;

	return this;
}

Peer.prototype.destroy = function() {
	debug('peer, peerId: %s, oldSocketId:  %s - #destroy.',
		this._peerId, this._oldSocketId);

	if (this._timeoutId) {
		clearTimeout(this._timeoutId);
		this._timeoutId = null;
	}

	this._messageQueue.length = 0;
	this._peerId = null;
	this._socketId = null;
	this._clientTimestamp = null;
	this._peerDisconnectedTimeout = null;
	this._timeoutId = null;
	this._oldSocketId = null;

	return this;
}

//jjv

jjv.addSchema('connect', {
	type: 'object',
	properties: {
		args: {
			type: 'object',
			properties: {
				clientTimestamp: {
					type: 'number'
				}
			},
			required: ['clientTimestamp']
		},
		type: {
			type: 'string',
			'enum': ['internalCommand']
		},
		internalCommand: {
			type: 'string',
			'enum': ['connect']
		}
	},
	required: ['args', 'type', 'internalCommand']
});

jjv.addSchema('reconnect', {
	type: 'object',
	properties: {
		args: {
			type: 'object',
			properties: {
				clientTimestamp: {
					type: 'number'
				},
				peerId: {
					type: 'number'
				}
			},
			required: ['clientTimestamp', 'peerId']
		},
		type: {
			type: 'string',
			'enum': ['internalCommand']
		},
		internalCommand: {
			type: 'string',
			'enum': ['reconnect']
		},
		required: ['args', 'internalCommand', 'type']
	}
});

jjv.test = function(schema, object) {
	var error = jjv.validate(schema, object);
	if (error) debug('schema %s, error: ', schema, error);

	return !!!error;

	//by default #validate returned error or null
	//i'm returned true - if all ok, or false - if error
}