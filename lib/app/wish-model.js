var mongoose = require('mongoose');
var cache = require('mongoose-cache');
var timestamps = require('mongoose-timestamp');
var crypto = require('crypto');
var logger = require('logfmt');
var Promise = require('promise');
var summarize = require('summarize');
var superagent = require('superagent');
var _ = require('lodash');
var Parse = require('parse').Parse;

var errors = require('./errors');
var keys = require('./keys');
var uuid = require('node-uuid');

var STATES = ['pending', 'complete', 'failed'];
var FIVE_MINUTES = 1000 * 60 * 5;

module.exports = function createWishModel(connection, maxAge) {

  // Monkey-patch Mongoose to support in-memory caching for 10s
  cache.install(mongoose, {
    max: 50,
    maxAge: maxAge
  });

  var Schema = mongoose.Schema({
    _id: { type: String },

    wishID: { type: String, unique: true, index: true },
    status: { type: Number },
    url: { type: String },
    oldPrice: { type: Number },
    newPrice: { type: String },
    //variation: { type: Number },
    site: { type: String },
    title: { type: String },
    username: { type: String },
    email: { type: String },

  }, {
    strict: true
  });

  Schema.plugin(timestamps);

  //Schema.virtual('voteCount').get(function getVoteCount() {
  //  return this.votes.length;
  //});

  Schema.set('toJSON', {
    getters: true,
    //transform: function safeTransform(doc, ret, options) {
    //  delete ret.votes;
    //}
  });

  Schema.statics = {

    scrape: function( userId, wish, user, product, site ) {
      return new Promise(function(resolve, reject) {
        var Wish = this;


        // needs to call tubes.io and store results in database
        var endpoint = product.productUrl.replace(/^.*\/\/[^\/]+/, '');
        var tube = site.tube.replace('https://', 'http://');
        logger.log({ type: 'info', msg: 'scraping product', url: tube + "?api_key=" + keys[keys.env].tubes + "&endpoint=" + endpoint});


        superagent
          .get(tube + "?api_key=" + keys[keys.env].tubes + "&endpoint=" + endpoint)
          .on('error', reject)
          .end(onResponse);

        function onResponse(res) {
          var tubeRes = JSON.parse(res.text);
          var id = uuid.v1();
          //console.log(res.req.path);
          if(res.status == 200){
              //var tubeRes = JSON.parse(res.text);
              //console.log(res.text);
              new Wish({
                _id: id,

                wishID: wish.objectId,
                status: res.status,
                url: res.req.path,
                oldPrice: product.originalPrice,
                newPrice: tubeRes.result.price,
                //variation: { type: Number },
                site: site.name,
                title: product.title,
                username: user.username,
                email: user.email,

              })
                .save(onSave);
          }else if(res.status == 500){
              //console.log(res.status + " " + tubeRes.result);
              new Wish({ _id: id, wishID: wish.objectId, url: res.req.path, site: site.name, title: product.title, status: res.status })
                .save(onSave);
          }
          /*var summary = summarize(res.text, 10);

          if (!summary.ok) return reject(new errors.ScrapeFailed());
          
          new Wish({ _id: id, url: url })
            .save(onSave);*/
        }

        function onSave(err, wish) {
          if (err) {
            logger.log({ type: 'error', msg: 'could not save', err: err });
            return reject(err);
          }
          logger.log({ type: 'info', msg: 'saved article', id: wish.id, url: wish.url });
          return resolve(wish);
        }

      }.bind(this));
    },

    get: function(id) {
      return new Promise(function(resolve, reject) {
        this.findById(id).exec(function(err, article) {
          if (err) return reject(err);
          if (!article) return reject(new errors.ArticleNotFound());
          resolve(article);
        });
      }.bind(this));
    },

    list: function(userId, n, fresh) {
      return new Promise(function(resolve, reject) {
        this.find()
          .sort('-createdAt')
          .limit(n || 50)
          .cache(!fresh)
          .exec(onArticles);

        function onArticles(err, articles) {
          if (err) return reject(err);
          resolve(articles);
        }
      }.bind(this));

      /*function toUser(article) {
        return article.forUser(userId);
      }

      function byScore(a, b) {
        return b.getScore() - a.getScore();
      }*/
    },

    deleteAll: function() {
      return new Promise(function(resolve, reject) {
        this.remove().exec(function(err) {
          if (err) return reject(err);
          resolve();
        });
      }.bind(this));
    }

  };



  Schema.methods = {

    /*addVote: function(userId) {
      return new Promise(function(resolve, reject) {
        if (this.votes.indexOf(userId) !== -1) {
          return reject(new errors.VoteNotAllowed());
        }

        this.votes.push(userId);
        this.save(onSave);

        function onSave(err, article) {
          if (err) return reject(err);
          resolve(article);
        }
      }.bind(this));
    },

    forUser: function(userId) {
      var obj = this.toJSON();
      obj.canVote = (this.votes.indexOf(userId) === -1);
      return obj;
    },

    getScore: function() {
      var staleness = Math.floor((Date.now() - this.createdAt) / FIVE_MINUTES);
      if (staleness === 0) staleness = -Infinity;
      return this.voteCount - staleness;
    }*/
  };

  var Wish = connection.model('Wish', Schema);
  return Wish;
};
