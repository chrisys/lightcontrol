module.exports = {
	dbconnection: require('./database'),
	io: io,
	schedule: require('node-schedule'),
	config: require('config'),
	suncalc: require('suncalc'),
	suncalc_latitude: 0,
	suncalc_longitude: 0,
	jobs: [],

	initialize: function() {
		// this resets all the requests (used on server startup)
		var _self = this;

		_self.suncalc_latitude = _self.config.get('app').latitude;
		_self.suncalc_longitude = _self.config.get('app').longitude;

		_self.dbconnection.getConnection(function(err, connection) {
			if(err) {
				return false;
			}

			var query = connection.query('SELECT `id`,`ip`,`channel`,`current_status`,`current_requested_status` FROM `channels` WHERE 1');

			query
			.on('error', function(err) {
				console.error('initialize: could not load initial data');
			})
			.on('result', function(row) {
				try {
					var response = require('child_process').execSync('php -f ./sr201/json_interface.php ' + row['ip'] + ' ' + row['channel'] + ' status', { timeout: 500 });

					var parsed_response = JSON.parse(response.toString());

					if(parsed_response.success == false)
					{
						_self.set_connectivity(row['id'],false);

					} else {
						_self.set_connectivity(row['id'],true);
						_self.set_status(row['id'],parsed_response.status);
					}
				} catch (ex) {
					console.log('execsync failure (' + row['id'] + ')');
					_self.set_connectivity(row['id'],false);
				}

			})
			.on('end', function() {
				connection.destroy();
				_self.check_and_action();
			});
		});

	},

	set_status: function(channel, state) {
		var _self = this;

		_self.dbconnection.getConnection(function(err, connection) {
			connection.query('UPDATE `channels` SET `current_status` = ' + state + ', `current_requested_status` = ' + state + ' WHERE `id` = ' + channel +';', function(err) {
				if(err) {
					console.error('set_status: could not save requested state');
				} else {
					console.log('set_status: channel ' + channel + ' state changed to ' + state);
				}
				connection.destroy();
			});
		});
	},

	set_connectivity: function(channel, connectivity) {
		var _self = this;

		console.log('set_connectivity: channel ' + channel);
		_self.dbconnection.getConnection(function(err, connection) {
			connection.query('UPDATE `channels` SET `connectivity` = ' + connectivity + ' WHERE `id` = ' + channel +';', function(err) {
				if(err) {
					console.error('set_connectivity: could not save connectivity');
				} else {
					console.log('set_connectivity: channel ' + channel + ' connectivity changed to ' + connectivity);
				}
				connection.destroy();
			});
		});
	},

	toggle_switch: function(channel, state) {
		var _self = this;

		console.log('-----------------');
		_self.dbconnection.getConnection(function(err, connection) {
			connection.query('UPDATE `channels` SET `current_requested_status` = ' + state + ' WHERE `id` = ' + channel +';', function(err) {
				if(err) {
					console.error('toggle_switch: could not save requested state');
				} else {
					console.log('toggle_switch: channel ' + channel + ' state changed to ' + state);

					// once the state has been changed, call the check and action to work out if they need to be applied now
					_self.check_and_action();
				}
				connection.destroy();
			});
		});
	},

	load_state: function(channel, socket) {
		var _self = this;
		console.log('load_state: loading state for channel ' + channel);

		_self.dbconnection.getConnection(function(err, connection) {
			connection.query('SELECT `current_requested_status`,`current_status` FROM `channels` WHERE `id` = ' + channel + ';', function (err, rows) {
				if(err) {
					console.error('load_state: could not load state for channel ' + channel);
				} else {
					if(rows.length == 1)
					{
						console.log('load_state: requested state for channel ' + channel + ' loaded (' + rows[0].current_requested_status + ')');
						console.log('load_state: state for channel ' + channel + ' loaded (' + rows[0].current_status + ')');

						socket.emit('notify change', { circuit: channel, set: rows[0].current_requested_status, status: rows[0].current_status });

						// check the jobs...
						var job_for_this_chan = false;

						var current_ts = Math.round(new Date().getTime()/1000.0);
						for(i = _self.jobs.length - 1; i>=0; i--)
						{
							if(_self.jobs[i].circuit == channel)
							{
								if(current_ts < _self.jobs[i].ts)
								{
									job_for_this_chan = true;
									_self.io.emit('update times', { circuit:_self.jobs[i].circuit, status: _self.jobs[i].status, ts: _self.jobs[i].ts, sent: false });
								}
							}
						}

						if(job_for_this_chan==false)
						{
							_self.io.emit('update times', { circuit: channel, status: null, ts: null, sent: false });
						}
					} else {
						// this is query ok but no rows
						console.error('load_state: could not load state for channel ' + channel);
					}
				}
				connection.destroy();
			});
		});
	},

	check_and_action: function() {
		var _self = this;

		_self.dbconnection.getConnection(function(err, connection) {
			var query = connection.query('SELECT `channels`.`id`,`ip`,`channel`,`minimum_on_time`,`minimum_off_time`,`power_on_group`,`current_status`,`current_requested_status`,`current_status_timestamp`,`power_on_groups`.`stagger_by`,`prohibited_time_periods`.`from` AS `prohibited_from`,`prohibited_time_periods`.`to` AS `prohibited_to`,`prohibited_time_periods`.`turn_off_frequency` FROM `channels` LEFT JOIN `power_on_groups` ON `channels`.`power_on_group` = `power_on_groups`.`id` LEFT JOIN `prohibited_time_periods` ON `channels`.`id` = `prohibited_time_periods`.`channel_id` WHERE 1');

			query
			.on('error', function(err) {
				console.error('check_and_action: could not load check_and_action data');
			})
			.on('result', function(row) {
				_self.check_and_action_single(row);
			})
			.on('end', function() {
				connection.destroy();
			});
		});
	},

	check_and_action_single: function(item) {
		var _self = this;

		if(item.current_status == item.current_requested_status) {
			console.log('check_and_action_single: channel ' + item.id + ' status OK');

			// cancel any jobs waiting that would otherwise change this OK status...
			console.log('check_and_action_single: jobs scheduled: '+_self.jobs.length);
			for(i = _self.jobs.length - 1; i>=0; i--)
			{
				// only cancel the job if the current_status is the same as the job status
				if(_self.jobs[i].circuit == item.id && _self.jobs[i].status == item.current_status)
				{
					console.log('check_and_action_single: cancelling job on channel '+item.id+' because '+item.current_status+' is '+_self.jobs[i].status);
					_self.jobs[i].job.cancel();
					_self.jobs.splice(i, 1);
				}
			}

			// recheck prohibited times to add scheduled off jobs
			_self.check_prohibited(item.id, item.ip, item.channel, item.current_status);

			_self.check_scheduled(item.id);

			return;
		} else {
			// if the status does not match
			console.log('check_and_action_single: requested status ' + item.current_requested_status + ' on channel '+ item.id);

			var current_ts = Math.round(new Date().getTime()/1000.0);
			var current_status_ts = item.current_status_timestamp.getTime()/1000;
			var permissible_action_ts = 0;

			if(item.current_requested_status == true && item.current_status == false)
			{
				// THIS IS SWITCHING ON
				console.log('check_and_action_single: attempting power on');

				// first check to make sure that the current time is > current_status_timestamp + minimum_off_time
				permissible_action_ts = current_status_ts + item.minimum_off_time;

				// then need to check to make sure that others in the same poweron group have not been switched on recently...
				_self.dbconnection.getConnection(function(err, connection) {
					connection.query('SELECT `id`,`current_status`,`current_status_timestamp` FROM `channels` WHERE `power_on_group` = ' + item.power_on_group + ' AND `id` <> ' + item.id, function(err, rows) {
						connection.destroy();
						if(err) {
							console.error('check_and_action_single: could not load power_on_groups for channel ' + item.id);
						} else {
							console.log('check_and_action_single: ' + rows.length + ' other members of power on group found');
							for(i = 0; i < rows.length; i++)
							{
								if(rows[i].current_status == true)
								{
									var check_stagger_ts = ((rows[i].current_status_timestamp.getTime()/1000) + item.stagger_by);
									if(current_ts < check_stagger_ts)
									{
										if(permissible_action_ts < check_stagger_ts)
										{
											console.log('check_and_action_single: pushing action ts forward due to stagger');
											permissible_action_ts = check_stagger_ts;
										}
									}
								}

								// also need to check if there are any power on jobs pending for this circuit that may push it forward even more...
								console.log('check_and_action_single: jobs scheduled: '+_self.jobs.length);
								for(j = 0; j < _self.jobs.length; j++)
								{
									if(_self.jobs[j].circuit == rows[i].id && ( permissible_action_ts < (_self.jobs[j].ts + item.stagger_by) && permissible_action_ts > (_self.jobs[j].ts - item.stagger_by)) && _self.jobs[j].status == true)
									{
										console.log('check_and_action_single: pushing action ts forward due to existing job');
										permissible_action_ts = _self.jobs[j].ts + item.stagger_by;
									}
								}
							}

							// check to make sure the permissible_action_ts is in the past, if it is can action immediately, if not it will be later so return the time to the ui
							if(permissible_action_ts < current_ts)
							{
								// doing it now
								_self.do_it_now(item.id, item.ip, item.channel, true, item.minimum_on_time);
								return _self.io.emit('update times', { circuit: item.id, status: 1, ts: null, sent: true });
							} else {
								// doing it later
								console.log('check_and_action_single: circuit has not been off for minimum time');
								_self.do_it_later(item.id, item.ip, item.channel, true, permissible_action_ts, item.minimum_on_time);
								return _self.io.emit('update times', { circuit: item.id, status: 1, ts: permissible_action_ts, sent: false });
							}
						}
					});
				});

			} else if(item.current_requested_status == false && item.current_status == true)
			{
				console.log('check_and_action_single: attempting power off');

				permissible_action_ts = current_status_ts + item.minimum_on_time;

				// there's only a stagger required on power on, not power off, so makes it simpler
				if(permissible_action_ts < current_ts)
				{
					// do it now
					_self.do_it_now(item.id, item.ip, item.channel, false, item.minimum_on_time);
					return _self.io.emit('update times', { circuit: item.id, status: 0, ts: null, sent: true });
				} else {
					// do it later
					console.log('check_and_action_single: circuit has not been on for minimum time');
					_self.do_it_later(item.id, item.ip, item.channel, false, permissible_action_ts, item.minimum_on_time);
					return _self.io.emit('update times', { circuit: item.id, status: 0, ts: permissible_action_ts, sent: false });
				}
			}
		}
	},

	do_it_now: function(id, ip, channel, status, minimum_on_time) {
		var _self = this;

		console.log('do_it_now: WARNING: SWITCHING CHANNEL '+ id +' ('+ channel +' ON '+ip+') TO '+status+' NOW');
		// do system exec...
		// need to wait for the response
		try {
			var response = require('child_process').execSync('php -f ./sr201/json_interface.php ' + ip + ' ' + channel + ' set '+ status, { timeout: 4500 });

			var parsed_response = JSON.parse(response.toString());

			_self.dbconnection.getConnection(function(err, connection) {
				if(parsed_response.success == true)
				{
					connection.query('UPDATE `channels` SET ? WHERE `id` = '+id+';' , { current_status: status, current_requested_status: status, current_status_timestamp: new Date(), connectivity: true }, function(err) {
						if(err) {
							console.log('do_it_now: could not set status');
						} else {
							console.log('do_it_now: new status set');

							// emit message to update the ui
							_self.io.emit('notify change', { circuit: id, set: status, status: status });
							_self.io.emit('notify message', { circuit: id, message: ''});

							// if we have just turned a circuit on, check the database to see if there are any prohibited time periods.
							// if there are, we schedule an automatic turn off job
							_self.check_prohibited(id, ip, channel, status, minimum_on_time);

						}
					});
				} else {
					// failure on board
					var query = connection.query('SELECT `id`,`current_status` FROM `channels` WHERE `id` = ' + id + ' LIMIT 1;');

					query.on('result', function(row) {
						console.log('do_it_now: reverting to previous state: circuit '+id+' state '+row.current_status);
						_self.toggle_switch(id, row.current_status);
						_self.io.emit('notify change', { circuit: id, set: row.current_status, status: row.current_status });
						_self.io.emit('notify message', { circuit: id, message: 'STATUSERROR'});
					}).on('end', function() {
						connection.destroy();
					});
				}

				connection.query('INSERT INTO `activity_log` SET ?;' , { timestamp: new Date(), channel_id: id, status: status, board_response: parsed_response.success }, function(err) {
					connection.destroy();
				});

				// as the thing has changed state, run another check on scheduled...
				_self.check_scheduled(id);
			});
		} catch (ex) {
			_self.dbconnection.getConnection(function(err, connection) {
				connection.query('INSERT INTO `activity_log` SET ?;' , { timestamp: new Date(), channel_id: id, status: status, board_response: false, comment: 'execSync exception' }, function(err) {

				});

				connection.query('UPDATE `channels` SET ? WHERE `id` = '+id+';' , { connectivity: false });

				var query = connection.query('SELECT `id`,`current_status` FROM `channels` WHERE `id` = ' + id + ' LIMIT 1;');

				query.on('result', function(row) {
					console.log('do_it_now: reverting to previous state: circuit '+id+' state '+row.current_status);
					_self.toggle_switch(id, row.current_status);
					_self.io.emit('notify change', { circuit: id, set: row.current_status, status: row.current_status });
					_self.io.emit('notify message', { circuit: id, message: 'STATUSERROR'});
				}).on('end', function() {
					connection.destroy();
				});

				// if this command failed, we do not know the state of the board
				// return the switch to it's previous state (from DB), and add message

			});
		}


		return;
	},

	do_it_later: function(id, ip, channel, status, ts, minimum_on_time) {
		var _self = this;

		// check to make sure we don't already have a job on this circuit
		for(i = _self.jobs.length - 1; i>=0; i--)
		{
			// check the timestamp here to make sure we are not cancelling and readding the same thing
			if(_self.jobs[i].circuit == id && _self.jobs[i].ts != ts)
			{
				console.log('do_it_later: cancelling job on channel '+id);
				_self.jobs[i].job.cancel();
				_self.jobs.splice(i, 1);
			}
		}

		var d = new Date(ts * 1000);
		var job = _self.schedule.scheduleJob(d, function(fid, fip, fchannel, fstatus, fminimum_on_time) {
			_self.do_it_now(fid, fip, fchannel, fstatus, fminimum_on_time);
			_self.io.emit('update times', { circuit: fid, status: fstatus, ts: null, sent: true });
		}.bind(null, id, ip, channel, status, minimum_on_time));

		_self.jobs.push({ circuit: id, job: job, status: status, ts: ts });
	},

	check_prohibited: function(id, ip, channel, status, minimum_on_time) {
		var _self = this;

		console.log('check_prohibited: cp channel '+id);

		var dt = new Date();

		if(status == true)
		{
			_self.dbconnection.getConnection(function(err, connection) {
				var query = connection.query('SELECT `from`,`to`,`turn_off_frequency` FROM `prohibited_time_periods` WHERE `channel_id` = ' + id + ';');

				query
				.on('error', function(err) {
					console.error('check_prohibited: could not load check_prohibited data');
				})
				.on('result', function(row) {
					// if the current ts is within the prohibited period, we schedule the off event for now + turn_off_frequency
					// if the current ts outside the prohibited period, we schedule the off event for the from time
					console.log('check_prohibited: '+row.from);
					console.log('check_prohibited: '+dt.toTimeString());

					// CAUTION: This is nonsense and all back asswards
					var startTime = row.to+'00';
					var endTime = row.from+'00';

					var s =  startTime.split(':');
					var dt1 = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(),
					                   parseInt(s[0]), parseInt(s[1]), parseInt(s[2]));

					var e =  endTime.split(':');
					var dt2 = new Date(dt.getFullYear(), dt.getMonth(),
					                   dt.getDate(),parseInt(e[0]), parseInt(e[1]), parseInt(e[2]));

					if(!(dt >= dt1 && dt <= dt2))
					{
						console.log('check_prohibited: turning off in '+row.turn_off_frequency);
						// we are currently in the prohibited period, so schedule the off for + turn_off_frequency
						var off_ts = (dt.getTime()/1000.0) + row.turn_off_frequency;

						_self.do_it_later(id, ip, channel, false, off_ts, minimum_on_time);
						_self.io.emit('update times', { circuit: id, status: false, ts: off_ts, sent: false });
					} else {
						// we are currently outside period, schedule off for start of the period
						// note need to bear in mind the minimum on time...
						console.log('check_prohibited: time period found');

						dt.setHours(row.from.substr(0,2));
						dt.setMinutes(row.from.substr(3,2));
						dt.setSeconds(0);
						var off_ts = (dt.getTime()/1000.0);

						// add an offset to cater for minimum_on_time
						if( ((new Date().getTime()/1000.0)+minimum_on_time) > off_ts) {
							off_ts = (new Date().getTime()/1000.0)+minimum_on_time;
						}

						off_ts = off_ts + ((id-1) * 2);

						_self.do_it_later(id, ip, channel, false, off_ts, minimum_on_time);
						_self.io.emit('update times', { circuit: id, status: false, ts: off_ts, sent: false });
					}

				})
				.on('end', function() {
					connection.destroy();
				});

			});
		} else {
			// currently off anyway so nobody cares
			console.log('check_prohibited: nobody cares');
			// remove below for now as it's incorrectly blanking on jobs
			// _self.io.emit('update times', { circuit: id, status: status, ts: null, sent: false });
		}
	},

	check_scheduled: function(id) {
		var _self = this;

		// console.log('check_scheduled: checking scheduled for: '+id);
		var now_ts = new Date().getTime()/1000;
		now_ts = Math.floor(now_ts);
		// console.log('check_scheduled: now ts '+now_ts);
		var earliest_event = { id: id, current_status: null, ip: null, channel: null, ts: null, action: null, minimum_on_time: null };

		// need to load any rows in the scheduled_events table for this id
		// then need to work out if any are applicable now
		// if they are then check to make sure there isn't one already in the queue for this event
		// if this particular event is in the queue then do nothing, otherwise put it in
		_self.dbconnection.getConnection(function(err, connection) {
			var query = connection.query('SELECT `ip`,`channel`,`timestamp`,`event`,`special_timestamp`,`minimum_on_time`,`current_status` FROM `scheduled_events` LEFT JOIN `channels` ON `channels`.`id` = `scheduled_events`.`channel_id` WHERE `scheduled_events`.`channel_id` = ' + id + ';');

			query
			.on('error', function(err) {
				console.log('check_scheduled: could not load scheduled_events data');
			})
			.on('result', function(row) {
				// have a row here... is this a normal timestamp or a most special juan?
				earliest_event.ip = row['ip'];
				earliest_event.channel = row['channel'];
				earliest_event.minimum_on_time = row['minimum_on_time'];
				earliest_event.current_status = row['current_status'];

				if(row.special_timestamp != null)
				{
					// console.log('check_scheduled: special juan');
					var special_timestamp_parts;
					special_timestamp_parts = row.special_timestamp.split('#');

					var times = _self.suncalc.getTimes(new Date(), _self.suncalc_latitude, _self.suncalc_longitude);
					var times_tomorrow = _self.suncalc.getTimes(new Date().strtotime('+1 day'), _self.suncalc_latitude, _self.suncalc_longitude);

					// if the current time is after sunset, need to be sure to use tomorrow's sunrise rather than today
					// console.log('check_scheduled: calculated sunrise: '+times.sunrise.toTimeString());
					// console.log('check_scheduled: calculated sunset: '+times.sunset.toTimeString());

					// console.log('check_scheduled: calculated sunrise tomorrow: '+times_tomorrow.sunrise.toTimeString());
					// console.log('check_scheduled: calculated sunset tomorrow: '+times_tomorrow.sunset.toTimeString());

					// with the specials we need to convert the data into the real timestamp before it can be used
					if(special_timestamp_parts[0]=='sunrise')
					{
						// console.log('check_scheduled: special sunrise '+special_timestamp_parts[1]);
						// the special timestamps are in the format: (sunrise|sunset)#(+|-)15 minutes
						// console.log('check_scheduled: calculated sunrise event ' + times.sunrise.strtotime(special_timestamp_parts[1]));
						event_ts = times.sunrise.strtotime(special_timestamp_parts[1]).getTime()/1000;
						event_ts = Math.floor(event_ts);
						tomorrow_event_ts = times_tomorrow.sunrise.strtotime(special_timestamp_parts[1]).getTime()/1000;
						tomorrow_event_ts = Math.floor(tomorrow_event_ts);
						console.log('check_scheduled: event ts '+event_ts);

						if(event_ts > now_ts && (earliest_event.ts == null || earliest_event.ts > event_ts))
						{
							earliest_event.ts = event_ts;
							earliest_event.action = row.event;
						}

						if(tomorrow_event_ts > now_ts && (earliest_event.ts == null || earliest_event.ts > tomorrow_event_ts))
						{
							earliest_event.ts = tomorrow_event_ts;
							earliest_event.action = row.event;
						}


					} else if(special_timestamp_parts[0]=='sunset')
					{
						// console.log('check_scheduled: special sunset '+special_timestamp_parts[1]);
						// console.log('check_scheduled: calculated sunset event ' + times.sunset.strtotime(special_timestamp_parts[1]));
						event_ts = times.sunset.strtotime(special_timestamp_parts[1]).getTime()/1000;
						event_ts = Math.floor(event_ts);
						tomorrow_event_ts = times_tomorrow.sunset.strtotime(special_timestamp_parts[1]).getTime()/1000;
						tomorrow_event_ts = Math.floor(tomorrow_event_ts);
						console.log('check_scheduled: event ts '+event_ts);

						if(event_ts > now_ts && (earliest_event.ts == null || earliest_event.ts > event_ts))
						{
							earliest_event.ts = event_ts;
							earliest_event.action = row.event;
						}

						if(tomorrow_event_ts > now_ts && (earliest_event.ts == null || earliest_event.ts > tomorrow_event_ts))
						{
							earliest_event.ts = tomorrow_event_ts;
							earliest_event.action = row.event;
						}
					}
				} else if (row.timestamp != null)
				{
					console.log('check_scheduled: normal time '+row.timestamp);
					var timestamp_parts;
					timestamp_parts = row.timestamp.split(':');

					event_ts_d = new Date();
					event_ts_d.setHours(timestamp_parts[0], timestamp_parts[1], timestamp_parts[2]);
					event_ts = event_ts_d.getTime()/1000;
					event_ts = Math.floor(event_ts);

					tomorrow_event_ts_d = new Date();
					tomorrow_event_ts_d.setHours(timestamp_parts[0], timestamp_parts[1], timestamp_parts[2]);
					tomorrow_event_ts_d.setHours(tomorrow_event_ts_d.getHours() + 24);
					tomorrow_event_ts = tomorrow_event_ts_d.getTime()/1000;
					tomorrow_event_ts = Math.floor(tomorrow_event_ts);

					if(event_ts > now_ts && (earliest_event.ts == null || earliest_event.ts > event_ts))
					{
						earliest_event.ts = event_ts;
						earliest_event.action = row.event;
					}

					if(tomorrow_event_ts > now_ts && (earliest_event.ts == null || earliest_event.ts > tomorrow_event_ts))
					{
						earliest_event.ts = tomorrow_event_ts;
						earliest_event.action = row.event;
					}

				}

			})
			.on('end', function() {
				console.log('check_scheduled: earliest event id ' + earliest_event.id + ' ip ' + earliest_event.ip + ' ch ' + earliest_event.channel + ' is ' + earliest_event.action + ' at ' + earliest_event.ts);
				connection.destroy();

				if(earliest_event.action == 'on')
				{
					if(earliest_event.current_status == 1)
					{
						return _self.io.emit('update times', { circuit: earliest_event.id, status: null, ts: null, sent: false });
					} else {
						_self.do_it_later(earliest_event.id, earliest_event.ip, earliest_event.channel, true, earliest_event.ts, earliest_event.minimum_on_time);
						return _self.io.emit('update times', { circuit: earliest_event.id, status: 1, ts: earliest_event.ts, sent: false });
					}
				} else if (earliest_event.action == 'off') {
					if(earliest_event.current_status == 0)
					{
						return _self.io.emit('update times', { circuit: earliest_event.id, status: null, ts: null, sent: false });
					} else {
						_self.do_it_later(earliest_event.id, earliest_event.ip, earliest_event.channel, false, earliest_event.ts, earliest_event.minimum_on_time);
						return _self.io.emit('update times', { circuit: earliest_event.id, status: 0, ts: earliest_event.ts, sent: false });
					}
				}

			});


		});


	}
};
