CREATE DATABASE IF NOT EXISTS lightcontrol;
USE lightcontrol;

# Dump of table activity_log
# ------------------------------------------------------------

CREATE TABLE `activity_log` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `timestamp` datetime DEFAULT NULL,
  `channel_id` int(11) DEFAULT NULL,
  `status` tinyint(1) DEFAULT NULL,
  `board_response` tinyint(1) DEFAULT NULL,
  `comment` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



# Dump of table channels
# ------------------------------------------------------------

CREATE TABLE `channels` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `ip` varchar(15) DEFAULT NULL,
  `channel` int(11) DEFAULT NULL,
  `minimum_on_time` int(11) DEFAULT NULL,
  `minimum_off_time` int(11) DEFAULT NULL,
  `power_on_group` int(11) DEFAULT NULL,
  `current_status` tinyint(1) DEFAULT NULL,
  `current_requested_status` tinyint(1) DEFAULT NULL,
  `current_status_timestamp` datetime NOT NULL,
  `connectivity` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



# Dump of table power_on_groups
# ------------------------------------------------------------

CREATE TABLE `power_on_groups` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `stagger_by` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



# Dump of table prohibited_time_periods
# ------------------------------------------------------------

CREATE TABLE `prohibited_time_periods` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `channel_id` int(11) DEFAULT NULL,
  `from` time DEFAULT NULL,
  `to` time DEFAULT NULL,
  `turn_off_frequency` int(11) DEFAULT NULL,
  `last_actioned` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



# Dump of table scheduled_events
# ------------------------------------------------------------

CREATE TABLE `scheduled_events` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `channel_id` int(11) NOT NULL,
  `timestamp` time DEFAULT NULL,
  `event` enum('on','off') NOT NULL,
  `special_timestamp` varchar(25) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;




/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
