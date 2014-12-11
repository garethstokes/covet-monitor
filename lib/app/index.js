var logger = require('logfmt');
var Promise = require('promise');
var uuid = require('node-uuid');
var EventEmitter = require('events').EventEmitter;
var Parse = require('parse').Parse;

var connections = require('./connections');
//var ArticleModel = require('./article-model');
var WishModel = require('./wish-model');
var keys = require('./keys');

var SCRAPE_QUEUE = 'jobs.scrape';
var VOTE_QUEUE = 'jobs.vote';


function App(config) {
  EventEmitter.call(this);

  this.config = config;
  this.connections = connections(config.mongo_url, config.rabbit_url);
  this.connections.once('ready', this.onConnected.bind(this));
  this.connections.once('lost', this.onLost.bind(this));

  Parse.initialize(keys[keys.env].appId, keys[keys.env].jsKey, keys[keys.env].master);
}

module.exports = function createApp(config) {
  return new App(config);
};

App.prototype = Object.create(EventEmitter.prototype);

App.prototype.onConnected = function() {
  var queues = 0;
  this.Wish = WishModel(this.connections.db, this.config.mongo_cache);
  this.connections.queue.create(SCRAPE_QUEUE, { prefetch: 5 }, onCreate.bind(this));
  this.connections.queue.create(VOTE_QUEUE, { prefetch: 5 }, onCreate.bind(this));

  function onCreate() {
    if (++queues === 2) this.onReady();
  }
};

App.prototype.onReady = function() {
  logger.log({ type: 'info', msg: 'app.ready' });
  this.emit('ready');
};

App.prototype.onLost = function() {
  logger.log({ type: 'info', msg: 'app.lost' });
  this.emit('lost');
};

App.prototype.addWish = function(userId, wish) {
  var id = uuid.v1();
  this.connections.queue.publish(SCRAPE_QUEUE, { id: id, wish: wish, userId: userId });
  return Promise.resolve(id);
};

App.prototype.loadWishes = function(userId){
  var query = new Parse.Query("Wish");
  query.include("ProductSiteRel");
  query.include("User");
  query.include("ProductSiteRel.Site");
  query.equalTo("bookmark", true);

  query.find().then(function(results){
    for(var i = 0; i < results.length; i++){
      if(results[i].get("ProductSiteRel").get("Site").get("tube") !== undefined){
        
        logger.log({ type: 'info', msg: 'loading job', queue: SCRAPE_QUEUE, wish: results[i].get("id") });
        this.connections.queue.publish(SCRAPE_QUEUE, { wish: results[i].toJSON(), userId: userId,
          user: results[i].get("User").toJSON(), product: results[i].get("ProductSiteRel").toJSON(), site: results[i].get("ProductSiteRel").get("Site").toJSON() });
      }
    }
  }.bind(this));
  return Promise.resolve("loading");

}

App.prototype.scrapeProduct = function(userId, wish, user, product, site) {
  return this.Wish.scrape(userId, wish, user, product, site);
};

/*App.prototype.addUpvote = function(userId, articleId) {
  this.connections.queue.publish(VOTE_QUEUE, { userId: userId, articleId: articleId });
  return Promise.resolve(articleId);
};*/

/*App.prototype.upvoteArticle = function(userId, articleId) {
  return this.Article.voteFor(userId, articleId);
};*/

App.prototype.purgePendingArticles = function() {
  logger.log({ type: 'info', msg: 'app.purgePendingArticles' });

  return new Promise(function(resolve, reject) {
    this.connections.queue.purge(SCRAPE_QUEUE, onPurge);

    function onPurge(err, count) {
      if (err) return reject(err);
      resolve(count);
    }
  }.bind(this));
};

/*App.prototype.purgePendingVotes = function() {
  logger.log({ type: 'info', msg: 'app.purgePendingVotes' });

  return new Promise(function(resolve, reject) {
    this.connections.queue.purge(VOTE_QUEUE, onPurge);

    function onPurge(err, count) {
      if (err) return reject(err);
      resolve(count);
    }
  }.bind(this));
};*/

App.prototype.getWish = function(id) {
  return this.Wish.get(id);
};

App.prototype.listWishes = function(userId, n, fresh) {
  return this.Wish.list(userId, n, fresh);
};

App.prototype.startScraping = function() {
  this.connections.queue.handle(SCRAPE_QUEUE, this.handleScrapeJob.bind(this));
  //this.connections.queue.handle(VOTE_QUEUE, this.handleVoteJob.bind(this));
  return this;
};

App.prototype.handleScrapeJob = function(job, ack) {
  logger.log({ type: 'info', msg: 'handling job', queue: SCRAPE_QUEUE, wish: job.wish.objectId });

  this
    .scrapeProduct(job.userId, job.wish, job.user, job.product, job.site )
    .then(onSuccess, onError);

  function onSuccess() {
    logger.log({ type: 'info', msg: 'job complete', status: 'success', wish: job.wish.objectId });
    ack();
  }

  function onError() {
    logger.log({ type: 'info', msg: 'job complete', status: 'failure', wish: job.wish.objectId });
    ack();
  }
};

/*App.prototype.handleVoteJob = function(job, ack) {
  logger.log({ type: 'info', msg: 'handling job', queue: VOTE_QUEUE, articleId: job.articleId });

  this
    .upvoteArticle(job.userId, job.articleId)
    .then(onSuccess, onError);

  function onSuccess() {
    logger.log({ type: 'info', msg: 'job complete', queue: VOTE_QUEUE, status: 'success' });
    ack();
  }

  function onError(err) {
    logger.log({ type: 'info', msg: 'job complete', queue: VOTE_QUEUE, status: 'failure', error: err });
    ack();
  }
};*/

App.prototype.stopScraping = function() {
  this.connections.queue.ignore(SCRAPE_QUEUE);
  this.connections.queue.ignore(VOTE_QUEUE);
  return this;
};

App.prototype.deleteAllArticles = function() {
  logger.log({ type: 'info', msg: 'app.deleteAllArticles' });
  return this.Wish.deleteAll();
};
