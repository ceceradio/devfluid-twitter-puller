var config = require('./config.js');
var twitter = require('twitter');
var twit = new twitter(config.twitter);
var mysql      = require('mysql');
var connection = mysql.createConnection(config.mysql);
var moment = require('moment');
var he = require('he');

var fs = require('fs');
var path = require('path');

var twitterUser = config.twitterUser;
var maxCountPerRequest = 200;
var gatherThisManyTweets = 600;
var maxRequestCount = 5;

var allTweets = [];

var timesAccessed = 0;
function getTweets(max_id) {
	var request = {user_id: twitterUser, include_rts: true, count: maxCountPerRequest};
	if (typeof max_id != "undefined") {
		request.max_id = max_id;
	}
	if (timesAccessed < maxRequestCount) {
		timesAccessed++;
		twit.get('/statuses/user_timeline.json', request, function(error, data, response) {
            if (error) {console.log(error); return;}
			if (typeof max_id != "undefined")
				data.shift();
			allTweets = allTweets.concat(data);
			console.log("Retrieved stauses: "+data.length);
			if (allTweets.count > gatherThisManyTweets) {
				processTweets();
			}
			else {
				getTweets(allTweets[allTweets.length-1].id_str);
			}
		});
	}
	else {
		// continue to next step
		processTweets();
	}
}

function processTweets() {
	console.log(allTweets.length);
	var saveData = {};
	saveData.count = allTweets.length;
	wordCloud(function(err,data) {
		if (err) {
			console.log(err);
			return;
		}
		saveData.wordCloud = data;
		simpleGraphData(function(err, data) {
			if (err) {
				console.log(err);
				return;
			}
			saveData.graphData = data;
			var query = connection.query("INSERT INTO "+config.mySQLTable+" SET ?", {robot_id: "twitter_puller", data: JSON.stringify(saveData), last_updated: moment().format("YYYY-MM-DD HH:mm:ss")}, function(err, result) {
				if (err)
					console.log("Error saving data");
				else
					console.log("Success: " + result);
			});
			console.log(query.sql);
		});
		
	});
	
}
function simpleGraphData(callback) {
	var tweets = [];
	for (var i=0; i<allTweets.length;i++) {
		var tweet = {};
		tweet.time = moment(new Date(allTweets[i].created_at)).format("X");
		if ("retweeted_status" in allTweets[i]) {
			tweet.is_retweet = true;
		}
		else {
			tweet.is_retweet = false;
		}
		if ("in_reply_to_user_id" in allTweets[i] && allTweets[i].in_reply_to_user_id != twitterUser) {
			tweet.is_reply = true;
		}
		else {
			tweet.is_reply = false;
		}
		tweet.geo = allTweets[i].geo;
		tweet.coordinates = allTweets[i].coordinates;
		tweet.place = allTweets[i].place;
		tweet.retweet_count = allTweets[i].retweet_count;
		tweet.favorite_count = allTweets[i].favorite_count;
		tweets.push(tweet);
	}
	callback(null, tweets);
}
function wordCloud(callback) {
	var dictionary = {};
	var stopwords = {};
	var filePath = path.join(__dirname, 'stopwords.txt');
	fs.readFile(filePath, 'utf-8', function(err,data) {
		if (err) {
			callback(err,null);
			return;
		}
		var stopwordsArray = data.split(/\s+/);
		for (var i=0;i<stopwordsArray.length;i++) {
			stopwords[stopwordsArray[i]] = i;
		}
		for (var i=0; i < allTweets.length; i++) {
			console.log("Starting Tweet: "+i);
			var tweet = allTweets[i];
			var matches = he.decode(tweet.text).trim().split(/\s+/);
			for (var j = 0; j < matches.length; j++) {
				if (matches[j].indexOf("@")===0)
					continue;
				if (matches[j].indexOf("http")===0)
					continue; 
				var match = matches[j].replace(/[^\w\uFF10-\uFF5A]/g, '');
				if (match in stopwords) {
					console.log("stopword: "+match);
					continue;
				}
				if (!match)
					continue;
				if (match in dictionary)
					dictionary[match]++;
				else
					dictionary[match] = 1;
			}
		}
		var cloudArray = [];
		for(var key in dictionary) {
			if (dictionary[key] > 1)
				cloudArray.push([key, dictionary[key]]);
		}
		cloudArray.sort(function(a,b) {
			return b[1] - a[1];
		});
		callback(null,cloudArray);
	});
}

if (!String.prototype.trim) {
   //code for trim
   String.prototype.trim=function(){return this.replace(/^\s+|\s+$/g, '');};
}

console.log("Starting retrieval");
getTweets();
setInterval(function() {
	allTweets = [];
	timesAccessed = 0;
	getTweets();
},1000 * 60 * 30);
