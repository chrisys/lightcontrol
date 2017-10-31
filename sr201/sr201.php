<?php

class sr201 {
	private $socket;
	private $num_channels;
	private $ip;
	private $port;

	private $read_status;

	function __construct($ip_address, $port = 6722, $num_channels = 2) {
		ini_set('default_socket_timeout', 1);

		$this->num_channels = $num_channels;

		$this->ip = $ip_address;
		$this->port = $port;

		$this->connect();
		$this->disconnect();
	}

	public function get_status() {
		$this->send_data('00');

		return $this->read_status;
	}

	public function get_channel_status($channel) {
		if(!$this->check_channel($channel))
		{
			return FALSE;
		}

		$status = $this->get_status();

		return substr($status, $channel-1, 1);
	}

	public function on($channel) {
		if(!$this->check_channel($channel))
		{
			return FALSE;
		}

		$this->send_data('1'.$channel);

	}

	public function off($channel) {
		if(!$this->check_channel($channel))
		{
			return FALSE;
		}

		$this->send_data('2'.$channel);
	}

	private function connect() {
		$this->socket = socket_create(AF_INET, SOCK_STREAM, SOL_TCP);

		if(!@socket_connect($this->socket, $this->ip, $this->port))
		{
			throw new exception('Unable to connect to board');
		}
	}

	private function disconnect() {
		socket_shutdown($this->socket);
		socket_close($this->socket);
	}

	private function check_channel($channel) {
		if(!is_numeric($channel) || $channel < 1 || $channel > 8 || $channel > $this->num_channels)
		{
			throw new exception('Invalid channel specified');
		}

		return TRUE;
	}

	private function send_data($data) {
		$this->connect();
		$send_status = socket_send($this->socket, $data, strlen($data), MSG_EOF);
		$this->receive_data();
		$this->disconnect();

		if($send_status!=strlen($data)) {
			return FALSE;
		} else {
			return TRUE;
		}
	}

	private function receive_data() {
		$data = null;

		if(($bytes = socket_recv($this->socket, $data, 8, MSG_WAITALL)) !== FALSE)
		{
			$this->read_status = $data;
		} else {
			$this->read_status = FALSE;
		}
	}
}

?>
