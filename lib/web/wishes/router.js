var express = require('express');
var path = require('path');

var ERR_MAP = {
  'ArticleNotFound': 404,
  'VoteNotAllowed': 403,
  'ScrapeFailed': 500
};

module.exports = function articlesRouter(app) {

  return new express.Router()
    .get('/', showForm)
    
    .get('/addWishes/', addWishes)
    .use(articleErrors)
    .use(express.static(path.join(__dirname, 'public')));

  function showForm(req, res, next) {
    res.render(path.join(__dirname, 'main'));
  }

  function listWishes(req, res, next) {
    app
      .listWishes(req.user.id, 15, req.param('fresh'))
      .then(sendList, next);

    function sendList(list) {
      res.json(list);
    }
  }

  function addWishes(req, res, next) {
    app
      .loadWishes(0)
      .then(sendList, next);

    function sendList(list) {
      res.json(list);
    }
  }

  function articleErrors(err, req, res, next) {
    var status = ERR_MAP[err.name];
    if (status) err.status = status;
    next(err);
  }
};
