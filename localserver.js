const fs = require('fs');
const express = require('express');
const readChunk = require('read-chunk');
const fileType = require('file-type');
const pump = require('pump');

var rangeRe = /^bytes=([0-9]*)-([0-9]*)$/;

function LocalServer() {
  this.app = express();
  this.source = null;
  var self = this;
  this.app.get('/', function(req, res) {
    var range = req.headers.range;
    var rangeArray = rangeRe.exec(range);
    var start = null;
    var end = null;
    if(rangeArray != null && rangeArray.length == 3) {
      if(rangeArray[1].length > 0) {
        start = parseInt(rangeArray[1]);
      }
      if(rangeArray[2].length > 0) {
        end = parseInt(rangeArray[2]);
      }
    }
    var source = self.source;
    if(source) {
      var contentLength = source.length;
      start = start ? start : 0;
      end = typeof end === 'number' ? end : contentLength - 1;
      if(rangeArray) res.status(206);
      res.setHeader('Content-Type', source.type);
      res.setHeader('Content-Length', end - start + 1);
      res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + contentLength);
      res.setHeader('Accept-Ranges', 'bytes');
      pump(source.createReadStream(start, end), res);
    }
    else {
      res.sendStatus(200);
    }
  });
}

LocalServer.prototype.setLocalSource = function(path) {
  this.source = {
    length: fs.statSync(path).size,
    type: fileType(readChunk.sync(path, 0, 262)),
    createReadStream: function(start, end) {
      return fs.createReadStream(path, {
        start: start,
        end: end
      });
    }
  };
};

LocalServer.prototype.setTorrentSource = function(magnet) { // TODO - implement
  source = {
    length: 0,
    type: '',
    createReadStream: function(start, end) {
      return null;
    }
  };
};

LocalServer.prototype.listen = function(port) {
  this.server = this.app.listen(port || 0);
};

module.exports = LocalServer;
