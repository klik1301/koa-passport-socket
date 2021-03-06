var Cookies = require('cookies');
var config = require('config');
var mongoose = require('mongoose');
var co = require('co');
var User = require('../models/user');

var socketIO = require('socket.io');
var socketEmitter = require('socket.io-emitter');

var redisClient = require('redis').createClient({ host: 'localhost', port: 6379 });

var socketRedis = require('socket.io-redis');

var sessionStore = require('./sessionStore');

function socket(server) {
  var io = socketIO(server);

  io.adapter(socketRedis(redisClient));

  io.use(function(socket, next) {
    var handshakeData = socket.request;


    var cookies = new Cookies(handshakeData, {}, config.keys);

    var sid = 'koa:sess:' + cookies.get('koa.sid');

    co(function*() {

      var session = yield* sessionStore.get(sid, true);

      if (!session) {
        throw new Error("No session");
      }

      if (!session.passport && !session.passport.user) {
        throw new Error("Anonymous session not allowed");
      }

      // if needed: check if the user is allowed to join
      socket.user = yield User.findById(session.passport.user).exec();

      // if needed later: refresh socket.session on events
      socket.session = session;

      session.socketIds = session.socketIds ? session.socketIds.concat(socket.id) : [socket.id];
      if (session.socketIds.length === 1) socket.broadcast.emit('server:userEnter', {name: socket.user.displayName});
      yield* sessionStore.save(sid, session);

      socket.emit('server:connectUser', {
        _id: socket.user._id,
        name: socket.user.displayName,
      });

      socket.on('client:sendMessage', (message, clb) => {
        socket.broadcast.emit('server:messageSended', {
          _id: socket.user._id,
          name: socket.user.displayName,
          text: message
        });
        socket.emit('server:messageSended', {
          _id: socket.user._id,
          name: socket.user.displayName,
          text: message
        });

        if (clb) clb();
      })

      socket.on('disconnect', function() {

        co(function* clearSocketId() {
          var session = yield* sessionStore.get(sid, true);
          if (session) {
            session.socketIds.splice(session.socketIds.indexOf(socket.id), 1);
            if (!session.socketIds.length) socket.broadcast.emit('server:userLeft', {name: socket.user.displayName});
            yield* sessionStore.save(sid, session);
          }
        }).catch(function(err) {
          console.error("session clear error", err);
        });
      });

    }).then(function() {
      next();
    }).catch(function(err) {
      next(err);
    });

  });

  io.on('connection', function (socket) {
    io.emit('message', 'vasya', 'hello');
  });
}


socket.emitter = socketEmitter(redisClient);

module.exports = socket;
