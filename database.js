var mysql = require('mysql');
var config = require('config');

var dbconnection = mysql.createPool(config.get('database'));

module.exports = dbconnection;
