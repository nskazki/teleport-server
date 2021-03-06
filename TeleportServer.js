/**
	https://github.com/nskazki/node-TeleportServer
	MIT
	from russia with love, 2014
*/

/**

	Public:

		destroy

	Events:

		socketsControllerReady -> ready
		socketsControllerError -> error
		socketsControllerDestroyed -> destroyed
		socketsControllerAlreadyDestroyed -> alreadyDestroyed

		peerReconnection -> clientReconnection
		peerDisconnection -> clientDisconnection
		peerConnection -> clientConnection
		peerDisconnectedTimeout -> clientDisconnectedTimeout
*/

"use strict";

var SocketsController = require('./libs/SocketsController');
var PeersController = require('./libs/PeersController');
var ObjectsController = require('./libs/ObjectsController');

var util = require('util');
var events = require('events');
var assert = require('assert');

var _ = require('lodash');
var patternMatching = require('pattern-matching');

var debug = require('debug')('TeleportServer:main');

module.exports = TeleportServer;

util.inherits(TeleportServer, events.EventEmitter);

function TeleportServer(params) {
	assert(patternMatching(params, {
		peerDisconnectedTimeout: 'integer',
		port: 'integer',
		objects: 'teleportedObjects',
		authFunc: 'function'
	}), 'does not match pattern.');

	this._params = params;

	this._objectsController = new ObjectsController(params.objects);
	this._socketsController = new SocketsController(params.port);
	this._peersController = new PeersController(params.peerDisconnectedTimeout, params.authFunc);

	this._socketsController.up(this._peersController);
	this._peersController.down(this._socketsController).up(this._objectsController);
	this._objectsController.down(this._peersController);

	this._isInit = true;

	this._bindOnControllersEvents();
}

TeleportServer.prototype.destroy = function() {
	if (this._isInit === true) {
		this._isInit = false;

		this.on('destroyed', function() {
			this._objectsController.removeAllListeners();
			this._socketsController.removeAllListeners();
			this._peersController.removeAllListeners();
		}.bind(this));

		this._objectsController.destroy();
		this._socketsController.destroy(); //-> socketsControllerDestroyed
		this._peersController.destroy();

	} else {
		debug('#destroy - TeleportServer alreadyDestroyed -> !alreadyDestroyed');
		this.emit('alreadyDestroyed');
	}

	return this;
};

TeleportServer.prototype._bindOnControllersEvents = function() {
	var peerSourceNames = ['peerReconnection', 'peerDisconnection', 'peerConnection', 'peerDisconnectedTimeout'];
	var peerNewNames = ['clientReconnection', 'clientDisconnection', 'clientConnection', 'clientDisconnectedTimeout'];

	this._createEvetnsProxy(
		this._peersController,
		peerSourceNames,
		peerNewNames
	);


	var socketSourceNames = ['socketsControllerReady', 'socketsControllerError', 'socketsControllerDestroyed', 'socketsControllerAlreadyDestroyed'];
	var socketNewNames = ['ready', 'error', 'destroyed', 'alreadyDestroyed'];

	this._createEvetnsProxy(
		this._socketsController,
		socketSourceNames,
		socketNewNames
	);
}

TeleportServer.prototype._createEvetnsProxy = function(object, eventsSourceNames, eventsNewNames) {
	for (var index = 0; index < eventsSourceNames.length; index++) {
		var sourceName = eventsSourceNames[index];
		var newName = (eventsNewNames) ? eventsNewNames[index] : sourceName;

		object.on(
			sourceName,
			this._createEventProxy(newName).bind(this)
		);
	}
}

TeleportServer.prototype._createEventProxy = function(eventName) {
	return function() {
		var arg = Array.prototype.slice.call(arguments);
		this.emit.apply(this, [eventName].concat(arg));
	}
}

//patternMatching
patternMatching.isTeleportedObjects = function(value) {
	if (!this.isNotEmptyObject(value)) return false;
	return _.values(value).every(function(value) {
		if (!this.isNotEmptyObject(value)) return false;

		if (!value.hasOwnProperty('object') ||
			!this.isObject(value.object)) return false;

		if (!value.hasOwnProperty('events') &&
			!value.hasOwnProperty('methods')) return false;

		if (value.hasOwnProperty('events')) {
			if (!this.isArray(value.events) ||
				!this.isFunction(value.object.emit)) return false;
		}

		if (value.hasOwnProperty('methods')) {
			if (!this.isArray(value.methods)) return false;

			if (!value.methods.every(function(method) {
				return this.isFunction(value.object[method]);
			}.bind(this))) return false;
		}

		return true;
	}.bind(this));
};