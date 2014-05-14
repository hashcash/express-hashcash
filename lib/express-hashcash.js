var Hashcash = require("hashcash"),
    uuid = require("node-uuid"),
    url = require("url"),
    fs = require('fs');

// **Usage:**
//
// > var hashcash = require("express-hashcash");
// > [...]
// > app.configure(function() {
// >    [...]
// >    app.use(express.static(__dirname + '/public'));
// >    app.use(express.session({ secret: "secret" }));
// >    app.use(hashcash({ 
// >        apikey: "PRIVATE-XXX-XXX",
// >        publickey: "XXX-XXX-XXX",
// >        complexity: 0.5
// >    }));
// >    [...]
// > });
module.exports = function(options) {

    var apikey     = options.apikey,
        publickey  = options.publickey,
        serverUrl  = options.serverUrl,

        // You may pass **option.complexity**. Larger this value -
        // longer it takes to compute work.
        // This is just a reference value passed to client and down
        // the middleware chain. You can always override that in your
        // code for specific cases. Like make it less for Login form
        // and make it larger for Registration form for example.
        complexity = options.complexity || 0.01;

    if (! apikey) {
        throw new Error("apikey option is required.");
    }

    if (! publickey) {
        throw new Error("publickey option is required.");
    }

    var api = new Hashcash(apikey, publickey, serverUrl);

    return function(req, res, next) {
        if (! req.session) {
            throw new Error("express.session is not configured. Make sure you .use(express.session) before hashcash.");
        }

        if (! req.session.hashcash) {
            req.session.hashcash = {
                tokens: []
            };
        }

        // Generate new token and store it in session
        var new_token = uuid.v4();
        req.session.hashcash.tokens.push(new_token);

        // Keep maximum 100 tokens in session
        if (req.session.hashcash.tokens.length > 100) {
            req.session.hashcash.tokens.shift();
        }

        // Make variables available for views
        res.locals.hashcash = {
            key        : publickey,
            restSrc    : '/hashcash.io/rest',
            workerSrc  : '/hashcash.io/worker.js',
            bundleSrc  : api.getBundleUrl(),
            formSrc    : '/hashcash.io/form.js',
            hashcashid : new_token,
            serverUrl  : api.getServerUrl(),
            complexity : complexity,
            work       : false
        };

        var apiCallPromise;

        // Check if submitted request contains hashcashId
        // If it does - check for work at hashcash.io servers
        // Also, since hashcashId token should be one time use,
        // delete it from list of tokens.
        if (req.param('hashcashid')) {
            var id = req.param('hashcashid');
            var pos = req.session.hashcash.tokens.indexOf(id);

            if (pos != -1) {
                delete req.session.hashcash.tokens[pos];
                apiCallPromise = api.getWorkById(id);
                apiCallPromise.then(function(work) {
                    res.locals.hashcash.work = work;
                });
            }
            else {
                res.locals.hashcash.error = "invalid token submitted";
            }
        }

        var pathname = url.parse(req.url).pathname;

        // **/hashcash.io/rest** will return current hashcash.io
        // config to be used by "single-page-app" type of client
        // applications. Sample return:
        //
        // > {
        // >    "key": "f2c91456-823e-482e-a62b-ba8cd7920308",
        // >    "restSrc": "/hashcash.io/rest",
        // >    "workerSrc": "/hashcash.io/worker.js",
        // >    "bundleSrc": "https://hashcash.io/js/libs/pow/pow.bundle.min.js",
        // >    "formSrc": "/hashcash.io/form.js",
        // >    "hashcashid": "23de527c-ae8a-45b1-b16d-2a31b0630e10",
        // >    "serverUrl": "https://hashcash.io/",
        // >    "complexity": 0.1,
        // >    "work": false
        // > }
        if (pathname == res.locals.hashcash.restSrc) {
            if (apiCallPromise) {
                apiCallPromise.then(function() {
                    res.json(res.locals.hashcash);
                });
            }
            else {
                res.json(res.locals.hashcash);
            }
            return;
        }

        // Serve worker code
        if (pathname == res.locals.hashcash.workerSrc) {
            api.getWorkerCode().then(function(code) {
                res.set('Content-Type', 'text/javascript');
                res.end(code);
            });
            return;
        }

        // Serve form.js helper code
        if (pathname == res.locals.hashcash.formSrc) {
            fs.readFile(__dirname + '/client/form.js', function(err, data) {
                if (err) { throw err; }
                res.end(data);
            });
            return;
        }

        // Make sure all pending requests to Hashcash.io API finished
        if (apiCallPromise) {
            apiCallPromise.then(function() {
                next();
            });
        }
        else {
            next();
        }
    };
};
