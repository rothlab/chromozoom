var global = self;  // grab global scope for Web Workers
require('./jquery.nodom.min.js')(global);
require('../ui/jquery.retina-canvas.js')(global, global.jQuery);
global._ = require('../underscore.min.js');
require('./CustomTracks.js')(global);
var utils = require('./genome-formats/utils/utils.js');
require('./track-types/utils/WorkerFonts.js')(global);

if (!global.console || !global.console.log) {
  global.console = global.console || {};
  global.console.log = function() {
    global.postMessage({log: JSON.stringify(_.toArray(arguments))});
  };
}

var CustomTrackWorker = {
  _tracks: [],
  _offscreenCanvases: {},
  _throwErrors: false,
  parse: function() {
    var self = this,
      tracks = CustomTracks.parse.apply(CustomTracks, arguments);
    return _.map(tracks, function(t) {
      // we want to keep the track object in our private store, and delete the data from the copy that
      // is sent back over the fence, since it is expensive/impossible to serialize
      t.id = self._tracks.push(t) - 1;
      var serializable = _.extend({}, t);
      delete serializable.data;
      return serializable;
    });
  },
  syncPropsAsync: function(track, props) {
    global.postMessage({id: track.id, syncProps: props});
  },
  throwErrors: function(toggle) {
    this._throwErrors = toggle;
  }
};

// Setup methods to pass through the appropriate track, as specified by the `id` in the message
_.each(CustomTracks.WORKER_METHODS, function(fn) {
  CustomTrackWorker[fn] = function() {
    var self = this,
      args = _.toArray(arguments),
      id = _.first(args),
      track = self._tracks[id],
      restOfArgs = _.rest(args),
      offscreen;
    
    // These functions contain an OffscreenCanvas in their first argument, which has some properties
    // alongside it that we restore onto the OffScreenCanvas (they are otherwise destroyed in the transfer)
    // so that it can function equivalently to a <canvas> in all downstream operations.
    if (_.contains(CustomTracks.OFFSCREEN_CANVAS_METHODS, fn) && restOfArgs[0].offscreen) {
      offscreen = restOfArgs[0].offscreen;
      if (global.OffscreenCanvas && offscreen instanceof global.OffscreenCanvas) {
        self._offscreenCanvases[restOfArgs[0].id] = offscreen;
      } else if (offscreen === true) {
        offscreen = self._offscreenCanvases[restOfArgs[0].id];
        // offscreen = self._offscreenCanvases[restOfArgs[0].id] = new OffscreenCanvas(restOfArgs[0].width, restOfArgs[0].height);
      }
      delete restOfArgs[0].offscreen;
      _.extend(offscreen, restOfArgs[0]);
      restOfArgs[0] = offscreen;
    }
    
    // Returning a value doesn't matter, because we're always firing a callback (the last argument)
    track[fn].apply(track, restOfArgs);
  };
});

global.CustomTrackWorker = CustomTrackWorker;

// Allows any OffscreenCanvas'es being returned to be stringified
function stringifyCanvases(key, value) {
  if (global.OffscreenCanvas && value instanceof global.OffscreenCanvas) {
    var canvasProps = {};
    Object.getOwnPropertyNames(value).forEach(function(key) {
      canvasProps[key] = value[key];
    });
    canvasProps.height = value.height;
    canvasProps.width = value.width;
    return canvasProps;
  }
  return value;
}

global.addEventListener('message', function(e) {
  var data = e.data,
    callback = function(r) { global.postMessage({id: data.id, ret: JSON.stringify(r || null, stringifyCanvases)}); },
    ret;

  if (CustomTrackWorker._throwErrors) {
    ret = CustomTrackWorker[data.op].apply(CustomTrackWorker, data.args.concat(callback));
  } else {
    try { ret = CustomTrackWorker[data.op].apply(CustomTrackWorker, data.args.concat(callback)); } 
    catch (err) { global.postMessage({id: data.id, error: JSON.stringify(err, utils.replaceErrors)}); }
  }
  
  if (!_.isUndefined(ret)) { callback(ret); }
});