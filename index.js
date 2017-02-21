// Example express application adding the parse-server module to expose Parse
// compatible API routes.

var express = require('express');
var app = express();
var path = require('path');

var ParseServer = require('parse-server').ParseServer;

// load the environment variables
var dotenv = require('dotenv').config();

var databaseUri = process.env.DATABASE_URI || process.env.MONGOLAB_URI;

if (!databaseUri) {
  console.log('DATABASE_URI not specified, falling back to localhost.');
}

var api = new ParseServer({
  logLevel: 'error', // use info for debugging
  databaseURI: databaseUri || 'mongodb://foo:blah@ds061325.mlab.com:61325/farmview', // 'mongodb://localhost:27017/dev',
  cloud: process.env.CLOUD_CODE_MAIN || __dirname + '/cloud/main.js',
  appId: process.env.APP_ID || 'bgVXRUCTrWhVpT3Ztrl2McZisxr1KZ4INFqLrI8X',
  masterKey: process.env.MASTER_KEY || 'k7BNuhwUDN7vYrT0XAmOi3CThIVDqLAehT5hQnFC', //Add your master key here. Keep it secret!
  serverURL: process.env.SERVER_URL || 'http://localhost:1337/parse',  // Don't forget to change to https if needed
  liveQuery: {
    classNames: ["Posts", "Comments"] // List of classes to support for query subscriptions
  }
});
// Client-keys like the javascript key or the .NET key are not necessary with parse-server
// If you wish you require them, you can set them as options in the initialization above:
// javascriptKey, restAPIKey, dotNetKey, clientKey


// Serve static assets from the /public folder
app.use('/public', express.static(path.join(__dirname, '/public')));

// Serve the Parse API on the /parse URL prefix
var mountPath = process.env.PARSE_MOUNT || '/parse';
app.use(mountPath, api);

// Parse Server plays nicely with the rest of your web routes
app.get('/', function(req, res) {
  res.status(200).send('Welcome to Forage!');
});

// There will be a test page available on the /test path of your server url
// Remove this before launching your app
//app.get('/test', function(req, res) {
  //res.sendFile(path.join(__dirname, '/public/test.html'));
//});

var port = process.env.PORT || 1337;
var httpServer = require('http').createServer(app);
httpServer.listen(port, function() {
    console.log('parse-server-example running on port ' + port + '.');
});

// This will enable the Live Query real-time server
ParseServer.createLiveQueryServer(httpServer);

