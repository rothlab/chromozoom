module.exports = (function(global){
  
  var _ = require('../underscore.min.js');
  
  // Some utility functions.
  var utils = require('./track-types/utils/utils.js'),
    parseDeclarationLine = utils.parseDeclarationLine;
  
  // The class that represents a singular custom track object
  var CustomTrack = require('./CustomTrack.js')(global);

  function TrackParseError(message, browserOpts, lineno, line) {
    this.name = 'TrackParseError';
    this.message = message;
    this.context = browserOpts.context;
    this.lineno = lineno;
    this.line = line.slice(0, 200);
  }
  TrackParseError.prototype = new Error;  

  // ========================================================================
  // = CustomTracks, the module that is exported to the global environment. =
  // ========================================================================
  //
  // Broadly speaking this is a factory for parsing data into CustomTrack objects,
  // and it can delegate this work to a worker thread.

  var CustomTracks = {
    _tracks: {},
    
    parse: function(chunks, browserOpts, parentOpts) {
      var customTracks = [],
        data = [],
        track, opts, m;
      
      if (typeof chunks == "string") { chunks = [chunks]; }
      
      function pushTrack() {
        if (track.parse(data)) { customTracks.push(track); }
      }
      
      customTracks.browser = {};
      _.each(chunks, function(text) {
        _.each(text.split("\n"), function(line, lineno) {
          if (/^#/.test(line)) {
            // comment line
          } else if (/^browser\s+/.test(line)) {
            // browser lines
            m = line.match(/^browser\s+(\w+)\s+(\S*)/);
            if (!m) { throw new TrackParseError("Could not parse browser line", browserOpts, lineno + 1, line); }
            customTracks.browser[m[1]] = m[2];
          } else if (/^track\s+/i.test(line)) {
            if (track) { pushTrack(); }
            opts = parseDeclarationLine(line, (/^track\s+/i));
            if (!opts) { throw new TrackParseError("Could not parse track line", browserOpts, lineno + 1, line); }
            if (parentOpts && _.isObject(parentOpts)) { opts = _.extend({}, parentOpts, opts); }
            opts.lineNum = lineno + 1;
            try { track = new CustomTrack(opts, browserOpts); }
            catch (err) { throw new TrackParseError(err.message, browserOpts, lineno + 1, line); }
            data = [];
          } else if (/\S/.test(line)) {
            if (!track) { 
              throw new TrackParseError("Plaintext track formats require a track definition line. For an example, " +
                  "see <a href=\"http://useast.ensembl.org/info/website/upload/bed.html#tracklines\">" +
                  "this page from Ensembl.</a>", browserOpts, lineno + 1, line); 
            }
            data.push(line);
          }
        });
      });
      if (track) { pushTrack(); }
      return customTracks;
    },
    
    parseDeclarationLine: parseDeclarationLine,
    
    error: function(e) {
      // Can be overridden by a parent library to handle errors more gracefully.
      // Note: this is overridden by ui.genobrowser during UI setup.
      console.log(e);
    },
    
    _workerScript: 'build/CustomTrackWorker.js',
    // NOTE: To temporarily disable Web Worker usage, set this to true.
    _disableWorkers: false,
    
    worker: function() { 
      var self = this,
        callbacks = [];
      if (!self._worker && global.Worker) { 
        self._worker = new global.Worker(self._workerScript);
        self._worker.addEventListener('error', function(e) { self.error(e); }, false);
        self._worker.addEventListener('message', function(e) {
          if (e.data.log) { console.log(JSON.parse(e.data.log)); return; }
          if (e.data.error) {
            if (e.data.id) { delete callbacks[e.data.id]; }
            self.error(JSON.parse(e.data.error));
            return;
          }
          if (e.data.syncProps) {
            self._tracks[e.data.id].syncProps(e.data.syncProps, true);
            return;
          }
          callbacks[e.data.id](JSON.parse(e.data.ret));
          delete callbacks[e.data.id];
        });
        self._worker.call = function(op, args, callback) {
          var id = callbacks.push(callback) - 1;
          this.postMessage({op: op, id: id, args: args});
        };
        // To have the worker throw errors instead of passing them nicely back, call this with toggle=true
        self._worker.throwErrors = function(toggle) {
          this.postMessage({op: 'throwErrors', args: [toggle]});
        };
      }
      return self._disableWorkers ? null : self._worker;
    },
    
    async: function(self, fn, args, asyncExtraArgs, wrapper) {
      args = _.toArray(args);
      wrapper = wrapper || _.identity;
      var argsExceptLastOne = _.initial(args),
        callback = _.last(args),
        w = this.worker();
      // Fallback if web workers are not supported.
      // This could also be tweaked to not use web workers when there would be no performance gain;
      //   activating this branch disables web workers entirely and everything happens synchronously.
      if (!w) { return callback(self[fn].apply(self, argsExceptLastOne)); }
      Array.prototype.unshift.apply(argsExceptLastOne, asyncExtraArgs);
      w.call(fn, argsExceptLastOne, function(ret) { callback(wrapper(ret)); });
    },
    
    parseAsync: function() {
      var self = this;
      self.async(self, 'parse', arguments, [], function(tracks) {
        // These have been serialized, so they must be hydrated into real CustomTrack objects.
        // We replace .prerender() with an asynchronous version.
        return _.map(tracks, function(t) {
          self._tracks[t.id] = _.extend(new CustomTrack(), t, {
            prerender: function() { CustomTrack.prototype.prerenderAsync.apply(this, arguments); }
          });
          return self._tracks[t.id];
        });
      });
    },
    
    guessFormat: function(firstChunk) {
      if (_.isUndefined(Uint8Array) || _.isUndefined(Uint32Array)) { return {}; }
      var chunkAsBytes = new Uint8Array(firstChunk),
        chunkAsUint32s = new Uint32Array(firstChunk),
        info = {
          binary: _.some(chunkAsBytes, function(i) { 
            return (i < 32 && i != 9 && i != 10 && i != 13) || i > 127; 
          })
        };      
      info.format = _.findKey(CustomTrack.types, function(spec, format) {
        return !!spec.magicBytes && _.contains(spec.magicBytes, chunkAsUint32s[0]);
      });
      return info;
    }
    
  };

  global.CustomTracks = CustomTracks;

});