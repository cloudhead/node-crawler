var events = require('events'),
    http = require('http'),
    url = require('url'),
    sys = require('sys');

var PATTERN = /<a\s[^>]+>\s*(?:<img\s[^>]+>|[^<]+)<\/a>/mig;
var DEFAULT_OPTIONS = {
    timeout: 5000
};

this.Crawler = function (options) {
    this.visited  = [];
    this.results  = [];
    this.rules    = [];
    this.matchers = [];
    this.clients  = {};
    this.options  = DEFAULT_OPTIONS;

    for (var k in options) { this.options[k] = options[k] }
};
this.Crawler.prototype = new(function () {
    this.crawl = function (/* url, ... */) {
        var that    = this;
        var urls    = arguments;
        var count   = urls.length;
        var promise = new(events.EventEmitter);

        this.visited = [];
        this.results = [];

        for (var i = 0; i < count; i++) {
            this.crawlURL(urls[i], promise).on('end', function (result) {
                Array.prototype.push.apply(that.results, result);

                if (! -- count) {
                    promise.emit('success', that.results);
                }
            });
        } 
        return promise;
    };

    this.crawlHTML = function (html, context, promise) {
        var that = this;
        var links = html.match(PATTERN) || [];

        context = context || {};
        promise = promise || new(events.EventEmitter);

        process.nextTick(function () {
            var urls = links.filter(function (link) {
                var href = link.match(/href="([^"]+)"/i)[1];
                var html = link.match(/^<a\s[^>]+>(.*?)<\/a>$/i)[1];
                var _url = url.parse(href);

                var follow = that.rules.every(function (rule) {
                    return rule.call(context, _url, html);
                });
                var match = that.matchers.some(function (matcher) {
                    return matcher.call(context, _url, html);
                });

                if (match) {
                    promise.emit('match', _url);
                    that.results.push(url.resolve(context.href, href));
                }

                if (follow && that.rules.length > 0 && that.visited.indexOf(href) === -1) {
                    promise.emit('follow', _url);
                    return true;
                } else {
                    promise.emit('skip', _url);
                }
                return false;
            });

            if (urls.length > 0) {
                urls.forEach(function (url) {
                    that.crawlURL(url).on('end', function () {
                        promise.emit('end');
                    });
                });
            } else {
                promise.emit('end');
            }
        });
        return promise;
    };

    this.crawlURL = function (href, promise) {
        var that = this;
        var _url = url.parse(href);

        promise = promise || new(events.EventEmitter);

        if (this.visited.indexOf(_url.href) !== -1) {
            process.nextTick(function () {
                promise.emit('skip', _url);
            });
        } else {
            this.request(_url, function (e, data) {
                if (e) { return promise.emit('error', e.error || e) }
                that.visited.push(_url.href);
                that.crawlHTML(data, _url, promise);
            });
        }
        return promise;
    };

    this.request = function (href, callback) {
        var that   = this;
        var client = this.clients[href.host] = this.clients[href.host] ||
                                               http.createClient(80, href.host, false);
        client.on('connect', function () {
            client.setTimeout(that.options.timeout);
            client.on('timeout', function () {
                callback({ error: 'timeout' });
                client.destroy();
            });
        });

        var request = client.request('GET', href.pathname + (href.search || ''), {
            host:   href.host,
            accept: 'text/html'
        });

        request.end();
        request.on('response', function (res) {
            var body = [];

            res.on('data', function (chunk) { body.push(chunk || '') });
            res.on('end',  function ()      { callback(null, body.join('')) });
        }).on('error', function (e) {
            callback(e);
        });
    };

    this.actions = {
        follow: function (rule) {
            this.rules.push(rule.call ? rule : function (url, html) {
                return rule.html.test(html) && rule.href.test(url.href);
            });
            return this;
        },
        skip: function (rule) {
            this.rules.push(rule.call ? function (url, html) {
                return !rule.call(this, url, html);
            } : function (html, href) {
                return !rule.html.test(html) && !rule.href.test(href);
            });
            return this;
        },
        match: function (rule) {
            this.matchers.push(rule.call ? rule : function (url, html) {
                return rule.html.test(html) && rule.href.test(url.href);
            });
            return this;
        }
    };

    this.rule = function (action, rule) {
        if (typeof(rule) === 'string') {
            action.call(this, { html: new(RegExp)(rule), href: /.*/ });
        } else if (rule.match) { // RegExp
            action.call(this, { html: rule, href: /.*/ });
        } else {                 // Object
            rule.html = rule.html || /.*/;
            rule.href = rule.href || /.*/;
            action.call(this, rule);
        }
        return this;
    };

    //
    // API
    //
    this.follow = function (rule) {
        return this.rule(this.actions.follow, rule);
    };
    this.skip = function (rule) {
        return this.rule(this.actions.skip, rule);
    };
    this.match = function (rule) {
        return this.rule(this.actions.match, rule);
    };
});

