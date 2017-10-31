<?php

require('sr201.php');

$ip = $argv[1];
$channel = $argv[2];
$func = $argv[3];

try {
	$board = new sr201($ip);
} catch(Exception $e) {
		echo json_encode(['success' => false]);
		exit();
}

$status = null;

switch($func) {
	case "status":
		$status = $board->get_channel_status($channel);
		echo json_encode(['status' => $status, 'success' => true]);
		exit();
	break;
	case "set":
		$switch = $argv[4];

		switch($switch) {
			case 'true':
				$board->on($channel);
				sleep(1);
				$status = $board->get_channel_status($channel);
				if($status == 1)
				{
					echo json_encode(['status' => $status, 'success' => true]);
				} else {
					echo json_encode(['status' => $status, 'success' => false]);
				}
			break;
			case 'false':
				$board->off($channel);
				sleep(1);
				$status = $board->get_channel_status($channel);
				if($status == 0)
				{
					echo json_encode(['status' => $status, 'success' => true]);
				} else {
					echo json_encode(['status' => $status, 'success' => false]);
				}
			break;
		}

		// check to make sure that the status setting applied


		exit();
	break;
}


?>
