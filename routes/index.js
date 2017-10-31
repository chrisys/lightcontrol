var express = require('express');
var config = require('config');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
	if(req.query.key == config.get('app').key)
	{
		timestamp = Date.now();

 		res.render('index', { timestamp: timestamp, appname: config.get('app').name });
	} else {

	res.writeHead(301,
	  { Location: config.get('app').redirect }
	);
	res.end();

	}
});

module.exports = router;
