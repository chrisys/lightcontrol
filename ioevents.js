var lightcontrol = require('./lightcontrol');

module.exports = {
		init: function(io) {
			var current_connections = 0;

			// some startup stuff on lightcontrol
			// check to make sure there are no outstanding requests...
			if(lightcontrol.initialize()===false) {
				return false;
			}

			io.on('connection', function (socket) {
				current_connections += 1;
				io.emit('user connected', { count: current_connections });
				io.emit('server time', { ts: Date.now() });

				lightcontrol.load_state(1, socket);
				lightcontrol.load_state(2, socket);
				lightcontrol.load_state(3, socket);
				lightcontrol.load_state(4, socket);
				lightcontrol.load_state(5, socket);

				socket.on('switch change', function (data) {
					lightcontrol.toggle_switch(data.circuit, data.set);

					socket.broadcast.emit('notify change', { circuit: data.circuit, set: data.set, status: null });
				});

				socket.on('disconnect', function () {
					current_connections -= 1;

					socket.broadcast.emit('user disconnected', { count: current_connections });
				});
			});
		}
};
