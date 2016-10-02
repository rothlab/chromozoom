var global = self;  // grab global scole for Web Workers
require('./jquery.nodom.min.js')(global);
global._ = require('../underscore.min.js');
require('./CustomTracks.js')(global);

if (!global.console || !global.console.log) {
  global.console = global.console || {};
  global.console.log = function() {
    global.postMessage({log: JSON.stringify(_.toArray(arguments))});
  };
}

var CustomTrackWorker = {
  _tracks: [],
  _throwErrors: false,
  parse: function(text, browserOpts) {
    var self = this,
      tracks = CustomTracks.parse(text, browserOpts);
    return _.map(tracks, function(t) {
      // we want to keep the track object in our private store, and delete the data from the copy that
      // is sent back over the fence, since it is expensive/impossible to serialize
      t.id = self._tracks.push(t) - 1;
      var serializable = _.extend({}, t);
      delete serializable.data;
      return serializable;
    });
  },
  prerender: function() {
    var args = _.toArray(arguments),
      id = _.first(args),
      track = this._tracks[id];
    track.prerender.apply(track, _.rest(args));
  },
  applyOpts: function() {
    var args = _.toArray(arguments),
      id = _.first(args),
      track = this._tracks[id];
    track.applyOpts.apply(track, _.rest(args));
  },
  finishSetup: function() {
    var args = _.toArray(arguments),
      id = _.first(args),
      track = this._tracks[id];
    track.finishSetup.apply(track, _.rest(args));
  },
  syncPropsAsync: function(track, props) {
    global.postMessage({id: track.id, syncProps: props});
  },
  throwErrors: function(toggle) {
    this._throwErrors = toggle;
  }
};

global.CustomTrackWorker = CustomTrackWorker;

global.addEventListener('message', function(e) {
  var data = e.data,
    callback = function(r) { global.postMessage({id: data.id, ret: JSON.stringify(r || null)}); },
    ret;

  if (CustomTrackWorker._throwErrors || true) {  // FIXME
    ret = CustomTrackWorker[data.op].apply(CustomTrackWorker, data.args.concat(callback));
  } else {
    try { ret = CustomTrackWorker[data.op].apply(CustomTrackWorker, data.args.concat(callback)); } 
    catch (err) { global.postMessage({id: data.id, error: JSON.stringify({message: err.message})}); }
  }
  
  if (!_.isUndefined(ret)) { callback(ret); }
});