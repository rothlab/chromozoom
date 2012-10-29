(function(global){
  
  // Some utility functions.

  function parseDeclarationLine(line, start) {
    var opts = {}, optname = '', value = '', state = 'optname';
    function pushValue(quoting) {
      state = 'optname';
      opts[optname.replace(/^\s+|\s+$/g, '')] = value;
      optname = value = '';
    }
    for (i = line.match(start)[0].length; i < line.length; i++) {
      c = line[i];
      if (state == 'optname') {
        if (c == '=') { state = 'startvalue'; }
        else { optname += c; }
      } else if (state == 'startvalue') {
        if (/'|"/.test(c)) { state = c; }
        else { value += c; state = 'value'; }
      } else if (state == 'value') {
        if (/\s/.test(c)) { pushValue(); }
        else { value += c; }
      } else if (/'|"/.test(state)) {
        if (c == state) { pushValue(state); }
        else { value += c; }
      }
    }
    if (state == 'value') { pushValue(); }
    if (state != 'optname') { return false; }
    return opts;
  }

  // Faster than Math.floor (http://webdood.com/?p=219)
  function floorHack(num) { return (num << 0) - (num < 0 ? 1 : 0); }

  function parseInt10(val) { return parseInt(val, 10); }

  // ========================================================================
  // = CustomTracks, the module that is exported to the global environment. =
  // ========================================================================

  var CustomTracks = {
    parse: function(text, browserOpts) {
      var customTracks = [],
        data = [],
        track, opts, m;
      function pushTrack() {
        if (track.parse(data)) { customTracks.push(track); }
      }
      customTracks.browser = {};
      _.each(text.split("\n"), function(line, lineno) {
        if (/^#/.test(line)) {
          // comment line
        } else if (/^browser\s+/.test(line)) {
          // browser lines
          m = line.match(/^browser\s+(\w+)\s+(\S*)/);
          if (!m) { throw new Error("Could not parse browser line found at line " + (lineno + 1)); }
          customTracks.browser[m[1]] = m[2];
        } else if (/^track\s+/i.test(line)) {
          if (track) { pushTrack(); }
          opts = parseDeclarationLine(line, (/^track\s+/i));
          if (!opts) { throw new Error("Could not parse track line found at line " + (lineno + 1)); }
          opts.lineNum = lineno + 1;
          track = new CustomTrack(opts, browserOpts);
          data = [];
        } else if (/\S/.test(line)) {
          if (!track) { throw new Error("Found data on line "+(lineno+1)+" but no preceding track definition"); }
          data.push(line);
        }
      });
      if (track) { pushTrack(); }
      return customTracks;
    },
    
    error: function(e) {
      // Can be overridden by a parent library to handle errors more gracefully.
      console.log(e);
    },
    
    // NOTE: To temporarily disable Web Worker usage, have this return null
    worker: function() { 
      var self = this,
        callbacks = [];
      if (!self._worker && global.Worker) { 
        self._worker = new global.Worker('js/CustomTrackWorker.js');
        self._worker.addEventListener('error', function(e) { self.error(e); }, false);
        self._worker.addEventListener('message', function(e) {
          if (e.data.log) { console.log(JSON.parse(e.data.log)); return; }
          if (e.data.error) {
            if (e.data.id) { callbacks[e.data.id] = null; }
            self.error(JSON.parse(e.data.error));
            return;
          }
          callbacks[e.data.id](JSON.parse(e.data.ret));
          callbacks[e.data.id] = null;
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
      return self._worker;
    },
    
    async: function(self, fn, args, asyncExtraArgs, wrapper) {
      args = _.toArray(args);
      wrapper = wrapper || _.identity;
      var firstargs = _.initial(args),
        callback = _.last(args),
        w = this.worker();
      // Fallback if web workers are not supported.
      // This could also be tweaked to not use web workers when there would be no performance gain;
      //   activating this branch disables web workers entirely and everything happens synchronously.
      if (!w) { return callback(self[fn].apply(self, firstargs)); }
      Array.prototype.unshift.apply(firstargs, asyncExtraArgs);
      w.call(fn, firstargs, function(ret) { callback(wrapper(ret)); });
    },
    
    parseAsync: function() {
      this.async(this, 'parse', arguments, [], function(tracks) {
        // These have been serialized, so they must be hydrated into real CustomTrack objects.
        // We replace .prerender() with an asynchronous version.
        return _.map(tracks, function(t) {
          return _.extend(new CustomTrack, t, {
            prerender: function() { CustomTrack.prototype.prerenderAsync.apply(this, arguments); }
          });
        });
        return tracks;
      });
    }
  };

  // ==============================================================================================
  // = LineMask: A (very cheap) alternative to IntervalTree: a small, 1D pixel buffer of objects. =
  // ==============================================================================================

  function LineMask(width, fudge) {
    this.fudge = fudge = (fudge || 1);
    this.items = [];
    this.mask = global.Uint8Array ? new Uint8Array(Math.ceil(width / fudge)) : new Array(Math.ceil(width / fudge));
  }

  LineMask.prototype.add = function(x, w, data) {
    var upTo = Math.ceil((x + w) / this.fudge);
    this.items.push({x: x, w: w, data: data});
    for (var i = floorHack(x / this.fudge); i < upTo; i++) { this.mask[i] = 1; }
  };

  LineMask.prototype.conflict = function(x, w) {
    var upTo = Math.ceil((x + w) / this.fudge);
    for (var i = floorHack(x / this.fudge); i < upTo; i++) { if (this.mask[i]) return true; }
    return false;
  };

  // =============================================================================
  // = CustomTrack, an object representing a custom track as understood by UCSC. =
  // =============================================================================

  function CustomTrack(opts, browserOpts) {
    if (!opts) { return; } // This is an empty customTrack that will be hydrated with values from a serialized object
    this._type = (opts.type && opts.type.toLowerCase()) || "bed";
    var type = this.type();
    if (type === null) { throw new Error("Unsupported track type '"+opts.type+"' encountered on line " + opts.lineNum); }
    this.opts = _.extend({}, this.constructor.defaults, type.defaults || {}, opts);
    _.extend(this, {
      browserOpts: browserOpts,
      stretchHeight: false,
      heights: {},
      sizes: ['dense'],
      mapSizes: [],
      areas: {}
    });
    this.init();
  }

  CustomTrack.defaults = {
    name: 'User Track',
    description: 'User Supplied Track',
    color: '0,0,0'
  }

  // Constructs a mapping function that converts bp intervals into pixel intervals, with optional calculations for text too
  CustomTrack.pixIntervalCalculator = function(start, width, bppp, withText, nameFunc, startkey, endkey) {
    if (!_.isFunction(nameFunc)) { nameFunc = function(d) { return d.name || ''; } }
    if (_.isUndefined(startkey)) { startkey = 'start'; }
    if (_.isUndefined(endkey)) { endkey = 'end'; }
    return function(d) {
      var pInt = {
        x: Math.round((d[startkey] - start) / bppp),
        w: Math.round((d[endkey] - d[startkey]) / bppp) + 1,
        t: 0,
        o: false // overflows into previous tile?
      };
      pInt.tx = pInt.x;
      pInt.tw = pInt.w;
      if (pInt.x < 0) { pInt.w += pInt.x; pInt.x = 0; pInt.o = true; }
      else if (withText) { 
        pInt.t = Math.min(nameFunc(d).length * 10 + 2, pInt.x);
        pInt.tx -= pInt.t;
        pInt.tw += pInt.t;  
      }
      pInt.w = Math.min(width - pInt.x, pInt.w);
      return pInt;
    };
  };

  CustomTrack.wigBinFunctions = {
    minimum: function(bin) { return bin.length ? Math.min.apply(Math, bin) : 0; },
    mean: function(bin) { return _.reduce(bin, function(a,b) { return a + b; }, 0) / bin.length; },
    maximum: function(bin) { return bin.length ? Math.max.apply(Math, bin) : 0; }
  };

  CustomTrack.types = {
  
    /*
      A few quick notes on setting up a format.
    
      + .parse(), .prerender(), and .render() MUST be defined.
      
      + .loadOpts() and .saveOpts() MAY be defined to handle dynamic updating of options via the Custom Track options dialog.
    
      + Defaults for track options can be put in .defaults.
    
      + The point of a format definition is to store data parsed from the track during .parse() and then draw it to a canvas
        upon a call to .render().
      
      + .parse() is handed an array of lines, which it can process as it likes.  It SHOULD fill .data with a convenient
        representation of the data found in the lines.  It MUST define .heights, .sizes, and .mapSizes in order for the 
        genobrowser to know what to do with the custom track.
    
      + To separate data retrieval and preprocessing (which can be handed off to a Web Worker to not block the UI thread)
        from drawing to the <canvas> and DOM operations (which unavoidably block the UI thread), .render() typically is built around
        a call to .prerender() that performs the data retrieval and preprocessing and hands off a drawSpec object to a callback.
        The callback, defined inline within .render(), is responsible for drawing everything within drawSpec to the <canvas>.
        drawSpec is ideally simplest set of data needed to quickly draw the image (e.g., rows of pixel positions.)
    
      + .prerender() can expect to access .data and all the CustomTrack.prototype methods, but not any of the DOM methods,
        since it MAY be running in a Web Worker.
      
      + .render() will not have access to .data or the CustomTrack.prototype methods if Web Workers are in use.
        It will always, however, have access to DOM methods.
      
      + start and end, as passed to .render(), are 1-based positions from the start of the genome, following the genobrowser
        convention.  
    */
  
    // =================================================================
    // = BED format: http://genome.ucsc.edu/FAQ/FAQformat.html#format1 =
    // =================================================================  
  
    bed: {
      defaults: {
        itemRgb: 'off',
        colorByStrand: '',
        useScore: 0,
        group: 'user',
        priority: 'user',
        offset: 0,
        url: '',
        htmlUrl: '',
        drawLimit: {squish: 500, pack: 100}
      },
      
      init: function() {
        this.type().initOpts.call(this);
      },
      
      initOpts: function() {
        var self = this,
          altColors = self.opts.colorByStrand.split(/\s+/),
          validColorByStrand = altColors.length > 1 && _.all(altColors, self.validateColor);
        self.opts.useScore = self.isOn(self.opts.useScore);
        self.opts.itemRgb = self.isOn(self.opts.itemRgb);
        if (!validColorByStrand) { self.opts.colorByStrand = ''; self.opts.altColor = null; }
        else { self.opts.altColor = altColors[1]; }
      },
    
      parseLine: function(line, lineno) {
        var cols = ['chrom', 'chromStart', 'chromEnd', 'name', 'score', 'strand', 'thickStart', 'thickEnd', 'itemRgb',
          'blockCount', 'blockSizes', 'blockStarts'],
          feature = {},
          chrPos;
        _.each(line.split(/\s+/), function(v, i) { feature[cols[i]] = v; });
        chrPos = this.browserOpts.chrPos[feature.chrom];
        lineno = lineno || 0;
        if (_.isUndefined(chrPos)) { 
          this.warn("Invalid chromosome at line " + (lineno + 1 + this.opts.lineNum));
          return null;
        } else {
          feature.score = _.isUndefined(feature.score) ? '?' : feature.score;
          feature.start = chrPos + parseInt10(feature.chromStart) + 1;
          feature.end = chrPos + parseInt10(feature.chromEnd) + 1;
        }
        return feature;
      },
    
      parse: function(lines) {
        var self = this,
          middleishPos = _.last(_.sortBy(_.values(this.browserOpts.chrPos), function(a,b){return a - b})) / 2,
          data = new IntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'});
        _.each(lines, function(line, lineno) {
          var feature = self.type().parseLine.call(self, line, lineno);
          feature && data.add(feature);
        });
        self.data = data;
        self.heights = {max: null, min: 15, start: 15};
        self.sizes = ['dense', 'squish', 'pack'];
        self.mapSizes = ['pack'];
        return true;
      },
      
      stackedLayout: function(intervals, width, calcPixInterval, lineNum) {
        lineNum = _.isFunction(lineNum) ? lineNum : function() { return; };
        var lines = [],
          maxExistingLine = _.max(_.map(intervals, function(v) { return lineNum(v.data) || 0 })) + 1,
          sortedIntervals = _.sortBy(intervals, function(v) { var ln = lineNum(v.data); return _.isUndefined(ln) ? 1 : -ln; });
        
        while (maxExistingLine-->0) { lines.push(new LineMask(width, 5)); }
        _.each(sortedIntervals, function(v) {
          var d = v.data,
            ln = lineNum(d),
            pInt = calcPixInterval(d),
            i = 0,
            l = lines.length;
          if (!_.isUndefined(ln)) {
            if (lines[ln].conflict(pInt.tx, pInt.tw)) { /*throw "Unresolvable LineMask conflict!";*/ }
            lines[ln].add(pInt.tx, pInt.tw, {pInt: pInt, d: d});
          } else {
            while (i < l && lines[i].conflict(pInt.tx, pInt.tw)) { ++i; }
            if (i == l) { lines.push(new LineMask(width, 5)); }
            lineNum(d, i);
            lines[i].add(pInt.tx, pInt.tw, {pInt: pInt, d: d});
          }
        });
        return _.map(lines, function(l) { return _.pluck(l.items, 'data'); });
      },
      
      prerender: function(start, end, density, precalc, callback) {
        var width = precalc.width,
          bppp = (end - start) / width,
          intervals = this.data.search(start, end),
          drawSpec = [],
          calcPixInterval = new CustomTrack.pixIntervalCalculator(start, width, bppp, density=='pack');
        
        function lineNum(d, set) {
          var key = bppp + '_' + density;
          if (!_.isUndefined(set)) { 
            if (!d.line) { d.line = {}; }
            return d.line[key] = set;
          }
          return d.line && d.line[key]; 
        };
        
        if (density == 'dense') {
          _.each(intervals, function(v) {
            var pInt = calcPixInterval(v.data);
            pInt.v = v.data.score;
            drawSpec.push(pInt);
          });
        } else {
          drawSpec = this.type().stackedLayout.call(this, intervals, width, calcPixInterval, lineNum);
        }
        return _.isFunction(callback) ? callback(drawSpec) : drawSpec;
      },
      
      addArea: function(areas, data, i, lineHeight, urlTemplate) {
        if (!areas) { return; }
        areas.push([
          data.pInt.x, i * lineHeight + 1, data.pInt.x + data.pInt.w, (i + 1) * lineHeight, //x1, x2, y1, y2
          data.d.name || '', // name
          urlTemplate.replace('$$', data.d.name), // href
          data.pInt.o, // continuation from previous tile?
          null,
          null,
          {position: data.d.chrom + ':' + data.d.chromStart, size: data.d.chromEnd - data.d.chromStart, score: data.d.score}
        ]);
      },
      
      // Scales a score from 0-1000 into an alpha value between 0.2 and 1.0
      calcAlpha: function(value) { return Math.max(value, 166)/1000; },
      
      drawFeature: function(ctx, data, i, lineHeight) {
        var self = this,
          color = self.opts.color;
        // TODO: add more drawing routines for exons, strand directionality, etc.
        if (self.opts.altColor && data.d.strand == '-') { color = self.opts.altColor; }
        if (self.opts.itemRgb && data.d.itemRgb && this.validateColor(data.d.itemRgb)) { color = data.d.itemRgb; }
        if (self.opts.useScore) { ctx.fillStyle = "rgba("+color+","+self.type('bed').calcAlpha(data.d.score)+")"; }
        else if (self.opts.itemRgb || self.opts.altColor) { ctx.fillStyle = "rgb(" + color + ")"; }
        ctx.fillRect(data.pInt.x, i * lineHeight + 1, data.pInt.w, lineHeight - 1);
      },
      
      drawSpec: function(canvas, drawSpec, density) {
        var self = this,
          ctx = canvas.getContext && canvas.getContext('2d'),
          urlTemplate = 'javascript:void("'+self.opts.name+':$$")',
          drawLimit = self.opts.drawLimit && self.opts.drawLimit[density],
          lineHeight = density == 'pack' ? 15 : 6,
          color = self.opts.color,
          areas = null;
                
        if (!ctx) { throw "Canvas not supported"; }
        if (density == 'pack') { areas = self.areas[canvas.id] = []; }
        
        if (density == 'dense') {
          canvas.height = 15;
          ctx.fillStyle = "rgb("+color+")";
          _.each(drawSpec, function(pInt) {
            if (self.opts.useScore) { ctx.fillStyle = "rgba("+color+","+self.type('bed').calcAlpha(pInt.v)+")"; }
            ctx.fillRect(pInt.x, 1, pInt.w, 13);
          });
        } else {
          if (drawLimit && drawSpec.length > drawLimit) { 
            canvas.height = 0; return;
          }
          canvas.height = drawSpec.length * lineHeight;
          ctx.fillStyle = "rgb("+color+")";
          _.each(drawSpec, function(l, i) {
            _.each(l, function(data) {
              self.type('bed').drawFeature.call(self, ctx, data, i, lineHeight);
              self.type('bed').addArea.call(self, areas, data, i, lineHeight, urlTemplate);
            });
          });
        }
      },
    
      render: function(canvas, start, end, density, callback) {
        var self = this;
        self.prerender(start, end, density, {width: canvas.width}, function(drawSpec) {
          self.type().drawSpec.call(self, canvas, drawSpec, density);
          _.isFunction(callback) && callback();
        });
      },
    
      loadOpts: function($dialog) {
        var o = this.opts,
          colorByStrandOn = /\d+,\d+,\d+\s+\d+,\d+,\d+/.test(o.colorByStrand),
          colorByStrand = colorByStrandOn ? o.colorByStrand.split(/\s+/)[1] : '0,0,0';
        $dialog.find('[name=colorByStrandOn]').attr('checked', !!colorByStrandOn);
        $dialog.find('[name=colorByStrand]').val(colorByStrand).change();
        $dialog.find('[name=useScore]').attr('checked', this.isOn(o.useScore));    
        $dialog.find('[name=url]').val(o.url);
      },
      
      saveOpts: function($dialog) {
        var o = this.opts,
          colorByStrandOn = $dialog.find('[name=colorByStrandOn]').is(':checked'),
          colorByStrand = $dialog.find('[name=colorByStrand]').val(),
          validColorByStrand = this.validateColor(colorByStrand);
        o.colorByStrand = colorByStrandOn && validColorByStrand ? o.color + ' ' + colorByStrand : '';
        o.useScore = $dialog.find('[name=useScore]').is(':checked') ? 1 : 0;
        o.url = $dialog.find('[name=url]').val();
        this.type('bed').initOpts.call(this);
      }
    },
    
    // =========================================================================
    // = bedGraph format: http://genome.ucsc.edu/goldenPath/help/bedgraph.html =
    // =========================================================================
  
    bedgraph: {
      defaults: {
        altColor: '',
        priority: 100,
        autoScale: 'on',
        alwaysZero: 'off',
        gridDefault: 'off',
        maxHeightPixels: '128:128:15',
        graphType: 'bar',
        viewLimits: '',
        yLineMark: 0.0,
        yLineOnOff: 'off',
        windowingFunction: 'maximum',
        smoothingWindow: 'off'
      },
    
      init: function() { return this.type('wiggle_0').init.call(this); },
      
      _binFunctions: CustomTrack.wigBinFunctions,
      
      initOpts: function() { return this.type('wiggle_0').initOpts.call(this); },
      
      applyOpts: function() { return this.type('wiggle_0').applyOpts.apply(this, arguments); },
      
      parse: function(lines) {
        var self = this,
          genomeSize = this.browserOpts.genomeSize,
          data = {all: []},
          mode, modeOpts, chrPos, m;
        self.range = self.isOn(this.opts.alwaysZero) ? [0, 0] : [Infinity, -Infinity];
      
        _.each(lines, function(line, lineno) {
          var cols = ['chrom', 'chromStart', 'chromEnd', 'dataValue'],
            datum = {},
            chrPos, start, end, val;
          _.each(line.split(/\s+/), function(v, i) { datum[cols[i]] = v; });
          chrPos = self.browserOpts.chrPos[datum.chrom];
          if (_.isUndefined(chrPos)) {
            self.warn("Invalid chromosome at line " + (lineno + 1 + self.opts.lineNum));
          }
          start = parseInt10(datum.chromStart);
          end = parseInt10(datum.chromEnd);
          val = parseFloat(datum.dataValue);
          data.all.push({start: chrPos + start, end: chrPos + end, val: val});
        });

        return self.type('wiggle_0').finishParse.call(self, data);
      },
      
      initDrawSpec: function() { return this.type('wiggle_0').initDrawSpec.apply(this, arguments); },
      
      drawBars: function() { return this.type('wiggle_0').drawBars.apply(this, arguments); },
    
      prerender: function(start, end, density, precalc, callback) {
        return this.type('wiggle_0').prerender.call(this, start, end, density, precalc, callback);
      },
    
      render: function(canvas, start, end, density, callback) {
        this.type('wiggle_0').render.call(this, canvas, start, end, density, callback);
      },
      
      loadOpts: function() { return this.type('wiggle_0').loadOpts.apply(this, arguments); },
      
      saveOpts: function() { return this.type('wiggle_0').saveOpts.apply(this, arguments); }
      
    },
  
    // ==================================================================
    // = WIG format: http://genome.ucsc.edu/goldenPath/help/wiggle.html =
    // ==================================================================
  
    wiggle_0: {
      defaults: {
        altColor: '',
        priority: 100,
        autoScale: 'on',
        alwaysZero: 'off',
        gridDefault: 'off',
        maxHeightPixels: '128:128:15',
        graphType: 'bar',
        viewLimits: '',
        yLineMark: 0.0,
        yLineOnOff: 'off',
        windowingFunction: 'maximum',
        smoothingWindow: 'off'
      },
    
      init: function() {
        this.type().initOpts.call(this);
      },
      
      _binFunctions: CustomTrack.wigBinFunctions,
      
      initOpts: function() {
        var o = this.opts,
          _binFunctions = this.type()._binFunctions;
        if (!this.validateColor(o.altColor)) { o.altColor = ''; }
        o.viewLimits = _.map(o.viewLimits.split(':'), parseFloat);
        o.maxHeightPixels = _.map(o.maxHeightPixels.split(':'), parseInt10);
        o.yLineOnOff = this.isOn(o.yLineOnOff);
        o.yLineMark = parseFloat(o.yLineMark);
        o.autoScale = this.isOn(o.autoScale);
        if (_binFunctions && !_binFunctions[o.windowingFunction]) {
          throw new Error("invalid windowingFunction at line " + o.lineNum); 
        }
        if (_.isNaN(o.yLineMark)) { o.yLineMark = 0.0; }
      },
      
      applyOpts: function() {
        var self = this,
          o = self.opts;
        self.drawRange = o.autoScale || o.viewLimits.length < 2 ? self.range : o.viewLimits;
        _.each({max: 0, min: 2, start: 1}, function(v, k) { self.heights[k] = o.maxHeightPixels[v]; });
        if (!o.altColor) {
          var hsl = this.rgbToHsl.apply(this, o.color.split(/,\s*/g));
          hsl[0] = hsl[0] + 0.02 % 1;
          hsl[1] = hsl[1] * 0.7;
          hsl[2] = 1 - (1 - hsl[2]) * 0.7;
          self.altColor = _.map(this.hslToRgb.apply(this, hsl), parseInt10).join(',');
        }
      },
    
      parse: function(lines) {
        var self = this,
          genomeSize = this.browserOpts.genomeSize,
          data = {all: []},
          mode, modeOpts, chrPos, m;
        self.range = self.isOn(this.opts.alwaysZero) ? [0, 0] : [Infinity, -Infinity];
      
        _.each(lines, function(line, lineno) {
          var val, start;
          if (m = line.match(/^(variable|fixed)Step\s+/i)) {
            mode = m[1].toLowerCase();
            modeOpts = parseDeclarationLine(line, /^(variable|fixed)Step\s+/i);
            modeOpts.start = parseInt10(modeOpts.start);
            if (mode == 'fixed' && (_.isNaN(modeOpts.start) || !modeOpts.start)) {
              throw new Error("fixedStep at line " + (lineno + 1 + self.opts.lineNum) + " require non-zero start parameter"); 
            }
            modeOpts.step = parseInt10(modeOpts.step);
            if (mode == 'fixed' && (_.isNaN(modeOpts.step) || !modeOpts.step)) {
              throw new Error("fixedStep at line " + (lineno + 1 + self.opts.lineNum) + " require non-zero step parameter"); 
            }
            modeOpts.span = parseInt10(modeOpts.span) || 1;
            chrPos = self.browserOpts.chrPos[modeOpts.chrom];
            if (_.isUndefined(chrPos)) {
              self.warn("Invalid chromosome at line " + (lineno + 1 + self.opts.lineNum));
            }
          } else {
            if (!mode) { 
              throw new Error("Wiggle format at " + (lineno + 1 + self.opts.lineNum) + " has no preceding mode declaration"); 
            } else if (_.isUndefined(chrPos)) {
              // invalid chromosome
            } else {
              if (mode == 'fixed') {
                val = parseFloat(line);
                data.all.push({start: chrPos + modeOpts.start, end: chrPos + modeOpts.start + modeOpts.span, val: val});
                modeOpts.start += modeOpts.step;
              } else {
                line = line.split(/\s+/);
                if (line.length < 2) {
                  throw new Error("variableStep at line " + (lineno + 1 + self.opts.lineNum) + " requires two values per line"); 
                }
                start = parseInt10(line[0]);
                val = parseFloat(line[1]);
                data.all.push({start: chrPos + start, end: chrPos + start + modeOpts.span, val: val});
              }
            }
          }
        });
        
        return self.type().finishParse.call(self, data);
      },
      
      finishParse: function(data) {
        var self = this,
          binFunction = self._binFunctions[self.opts.windowingFunction];
        if (data.all.length > 0) {
          self.range[0] = _.min(data.all, function(d) { return d.val; }).val;
          self.range[1] = _.max(data.all, function(d) { return d.val; }).val;
        }
        data.all = new SortedList(data.all, {
          compare: function(a, b) {
            if (a == null) return -1;
            if (b == null) return  1;
            var c = a.start - b.start;
            return (c > 0) ? 1 : (c == 0)  ? 0 : -1;
          }
        });
      
        // Pre-optimize data for high bppps by downsampling
        _.each(self.browserOpts.bppps, function(bppp) {
          if (self.browserOpts.genomeSize / bppp > 1000000) { return; }
          var pixLen = Math.ceil(self.browserOpts.genomeSize / bppp),
            downsampledData = (data[bppp] = (global.Float32Array ? new Float32Array(pixLen) : new Array(pixLen))),
            j = 0,
            curr = data.all.get(0),
            bin, next;
          for (var i = 0; i < pixLen; i++) {
            bin = curr && (curr.start <= i * bppp && curr.end > i * bppp) ? [curr.val] : [];
            while ((next = data.all.get(j + 1)) && next.start < (i + 1) * bppp && next.end > i * bppp) { 
              bin.push(next.val); ++j; curr = next; 
            }
            downsampledData[i] = binFunction(bin);
          }
          data._binFunction = self.opts.windowingFunction;
        });
        self.data = data;
        self.stretchHeight = true;
        self.type('wiggle_0').applyOpts.apply(self);
        return true; // success!
      },
      
      initDrawSpec: function(precalc) {
        var vScale = (this.drawRange[1] - this.drawRange[0]) / precalc.height,
          drawSpec = {
            bars: [],
            vScale: vScale,
            yLine: this.isOn(this.opts.yLineOnOff) ? Math.round((this.opts.yLineMark - this.drawRange[0]) / vScale) : null, 
            zeroLine: -this.drawRange[0] / vScale
          };
        return drawSpec;
      },
    
      prerender: function(start, end, density, precalc, callback) {
        var self = this,
          bppp = (end - start) / precalc.width,
          drawSpec = self.type().initDrawSpec.call(self, precalc),
          binFunction = self._binFunctions[self.opts.windowingFunction],
          downsampledData;
        if (self.data._binFunction == self.opts.windowingFunction && (downsampledData = self.data[bppp])) {
          // We've already pre-optimized for this bppp
          drawSpec.bars = _.map(_.range((start - 1) / bppp, (end - 1) / bppp), function(xFromOrigin, x) {
            return ((downsampledData[xFromOrigin] || 0) - self.drawRange[0]) / drawSpec.vScale;
          });
        } else {
          // We have to do the binning on the fly
          var j = self.data.all.bsearch({start: start}),
            curr = self.data.all.get(j), next, bin;
          for (var i = 0; i < precalc.width; i++) {
            bin = curr && (curr.end >= i * bppp + start) ? [curr.val] : [];
            while ((next = self.data.all.get(j + 1)) && next.start < (i + 1) * bppp + start && next.end >= i * bppp + start) { 
              bin.push(next.val); ++j; curr = next; 
            }
            drawSpec.bars.push((binFunction(bin) - self.drawRange[0]) / drawSpec.vScale);
          }
        }
        return _.isFunction(callback) ? callback(drawSpec) : drawSpec;
      },
      
      drawBars: function(ctx, drawSpec, height, width) {
        var zeroLine = drawSpec.zeroLine,
          color = "rgb("+this.opts.color+")",
          altColor = "rgb("+(this.opts.altColor || this.altColor)+")";
        
        ctx.fillStyle = color;
        _.each(drawSpec.bars, function(d, x) {
          if (d === null) { return; }
          else if (d > zeroLine) { ctx.fillRect(x, height - d, 1, zeroLine > 0 ? (d - zeroLine) : d); }
          else {
            ctx.fillStyle = altColor;
            ctx.fillRect(x, height - zeroLine, 1, zeroLine - d);
            ctx.fillStyle = color;
          }
        });
        if (drawSpec.yLine !== null) {
          ctx.fillStyle = "rgb(0,0,0)";
          ctx.fillRect(0, height - drawSpec.yLine, width, 1);
        }
      },
    
      render: function(canvas, start, end, density, callback) {
        var self = this,
          height = canvas.height,
          width = canvas.width,
          ctx = canvas.getContext && canvas.getContext('2d');
        if (!ctx) { throw "Canvas not supported"; }
        self.prerender(start, end, density, {width: width, height: height}, function(drawSpec) {
          self.type().drawBars.call(self, ctx, drawSpec, height, width);
          _.isFunction(callback) && callback();
        });
      },
      
      loadOpts: function($dialog) {
        var o = this.opts,
          $viewLimits = $dialog.find('.view-limits'),
          $maxHeightPixels = $dialog.find('.max-height-pixels');
        $dialog.find('[name=altColorOn]').attr('checked', this.isOn(o.yLineOnOff)).change();
        $dialog.find('[name=altColor]').val(o.altColor).change();
        $dialog.find('[name=autoScale]').attr('checked', !this.isOn(o.autoScale)).change();
        $viewLimits.slider("option", "min", this.range[0]);
        $viewLimits.slider("option", "max", this.range[1]);
        $dialog.find('[name=viewLimitsMin]').val(this.drawRange[0]).change();
        $dialog.find('[name=viewLimitsMax]').val(this.drawRange[1]).change();
        $dialog.find('[name=yLineOnOff]').attr('checked', this.isOn(o.yLineOnOff)).change();
        $dialog.find('[name=yLineMark]').val(o.yLineMark).change();
        $dialog.find('[name=graphType]').val(o.graphType).change();
        $dialog.find('[name=windowingFunction]').val(o.windowingFunction).change();
        $dialog.find('[name=maxHeightPixelsOn]').attr('checked', o.maxHeightPixels.length >= 3);
        $dialog.find('[name=maxHeightPixelsMin]').val(o.maxHeightPixels[2]).change();
        $dialog.find('[name=maxHeightPixelsMax]').val(o.maxHeightPixels[0]).change();
      },
      
      saveOpts: function($dialog) {
        var o = this.opts,
          altColorOn = $dialog.find('[name=altColorOn]').is(':checked'),
          maxHeightPixelsOn = $dialog.find('[name=maxHeightPixelsOn]').is(':checked'),
          maxHeightPixelsMax = $dialog.find('[name=maxHeightPixelsMax]').val();
        o.altColor = altColorOn ? $dialog.find('[name=altColor]').val() : '';
        o.autoScale = !$dialog.find('[name=autoScale]').is(':checked');
        o.viewLimits = $dialog.find('[name=viewLimitsMin]').val() + ':' + $dialog.find('[name=viewLimitsMax]').val();
        o.yLineOnOff = $dialog.find('[name=yLineOnOff]').is(':checked');
        o.yLineMark = $dialog.find('[name=yLineMark]').val();
        o.graphType = $dialog.find('[name=graphType]').val();
        o.windowingFunction = $dialog.find('[name=windowingFunction]').val();
        o.maxHeightPixels = maxHeightPixelsOn ? 
          [maxHeightPixelsMax, maxHeightPixelsMax, $dialog.find('[name=maxHeightPixelsMin]').val()].join(':') : '';
        this.type('wiggle_0').initOpts.call(this);
      }
      
    },
  
    // ====================================================================
    // = vcfTabix format: http://genome.ucsc.edu/goldenPath/help/vcf.html =
    // ====================================================================
  
    vcftabix: {
      defaults: {
        priority: 100,
        maxWindowToDraw: 0,
        chromosomes: ''
      },
    
      init: function() {
        if (!this.opts.bigDataUrl) {
          throw new Error("Required parameter bigDataUrl not found for vcfTabix track at " + JSON.stringify(this.opts) + (this.opts.lineNum + 1));
        }
      },
    
      parse: function(lines) {
        var self = this;
        self.heights = {max: null, min: 15, start: 15};
        self.sizes = ['dense', 'squish', 'pack'];
        self.mapSizes = ['pack'];
        return true;
      },
    
      prerender: function(start, end, density, precalc, callback) {
        var self = this,
          width = precalc.width,
          data = self.data,
          bppp = (end - start) / width,
          range = this.chrRange(start, end);
        
        function lineToInterval(line) {
          var fields = line.split('\t'), data = {}, info = {};
          if (fields[7]) {
            _.each(fields[7].split(';'), function(l) { l = l.split('='); if (l.length > 1) { info[l[0]] = l[1]; } });
          }
          data.start = self.browserOpts.chrPos[fields[0]] + parseInt10(fields[1]);
          data.id = fields[2]=='.' ? 'vcf-' + Math.floor(Math.random() * 100000000) : fields[2];
          data.end = data.start + 1;
          data.ref = fields[3];
          data.alt = fields[4];
          data.qual = parseFloat(fields[5]);
          data.info = info;
          return {data: data};
        }
        function nameFunc(fields) {
          return (fields.ref.length > fields.alt.length ? fields.ref : fields.alt) || '';
        }
      
        function success(data) {
          var drawSpec = [],
            lines = _.filter(data.split('\n'), function(l) { var m = l.match(/\t/g); return m && m.length > 8; }),
            calcPixInterval = new CustomTrack.pixIntervalCalculator(start, width, bppp, density=='pack', nameFunc);
          if (density == 'dense') {
            _.each(lines, function(line) {
              drawSpec.push(calcPixInterval(lineToInterval(line).data));
            });
          } else {
            drawSpec = self.type('bed').stackedLayout(_.map(lines, lineToInterval), width, calcPixInterval);
          }
          callback(drawSpec);
        }
      
        $.ajax(this.ajaxDir() + 'tabix.php', {
          data: {range: range, url: this.opts.bigDataUrl},
          success: success
        });
      },
    
      render: function(canvas, start, end, density, callback) {
        var ctx = canvas.getContext && canvas.getContext('2d'),
          urlTemplate = 'javascript:void("'+this.opts.name+':$$")',
          lineHeight = density == 'pack' ? 27 : 6,
          colors = {a:'255,0,0', t:'255,0,255', c:'0,0,255', g:'0,255,0'},
          areas = null;
        if (!ctx) { throw "Canvas not supported"; }
        if (density == 'pack') { areas = this.areas[canvas.id] = []; }
        ctx.fillStyle = "rgb(0,0,0)";
        this.prerender(start, end, density, {width: canvas.width}, function(drawSpec) {
          if (density == 'dense') {
            canvas.height = 15;
            _.each(drawSpec, function(pInt) {
              ctx.fillRect(pInt.x, 1, pInt.w, 13);
            });
          } else {
            canvas.height = drawSpec.length * lineHeight;
            _.each(drawSpec, function(l, i) {
              _.each(l, function(data) {
                var altColor, refColor;
                if (areas) {
                  refColor = colors[data.d.ref.toLowerCase()] || '255,0,0';
                  altColor = colors[data.d.alt.toLowerCase()] || '255,0,0';
                  ctx.fillStyle = "rgb(" + altColor + ")"; 
                }
                ctx.fillRect(data.pInt.x, i * lineHeight + 1, data.pInt.w, lineHeight - 1);
                if (areas) {
                  areas.push([
                    data.pInt.x, i * lineHeight + 1, data.pInt.x + data.pInt.w, (i + 1) * lineHeight, //x1, x2, y1, y2
                    data.d.ref + ' > ' + data.d.alt, // title
                    urlTemplate.replace('$$', data.d.id), // href
                    data.pInt.o, // continuation from previous tile?
                    altColor, // label color
                    '<span style="color: rgb(' + refColor + ')">' + data.d.ref + '</span><br/>' + data.d.alt, // label
                    data.d.info
                  ]);
                }
              });
            });
          }
          _.isFunction(callback) && callback();
        });
      }
    },
  
    // =====================================================================
    // = bigBed format: http://genome.ucsc.edu/goldenPath/help/bigBed.html =
    // =====================================================================
  
    bigbed: {
      defaults: {
        priority: 100,
        maxWindowToDraw: 0,
        chromosomes: '',
        itemRgb: 'off',
        colorByStrand: '',
        useScore: 0,
        group: 'user',
        priority: 'user',
        offset: 0,
        url: '',
        htmlUrl: '',
        drawLimit: {squish: 500, pack: 100}
      },
    
      init: function() {
        if (!this.opts.bigDataUrl) {
          throw new Error("Required parameter bigDataUrl not found for bigBed track at " + JSON.stringify(this.opts) + (this.opts.lineNum + 1));
        }
      },
      
      parse: function(lines) {
        var self = this;
        self.heights = {max: null, min: 15, start: 15};
        self.sizes = ['dense', 'squish', 'pack'];
        self.mapSizes = ['pack'];
        return true;
      },
    
      prerender: function(start, end, density, precalc, callback) {
        var self = this,
          width = precalc.width,
          data = self.data,
          bppp = (end - start) / width,
          range = this.chrRange(start, end);
        
        function lineNum(d, set) {
          var key = bppp + '_' + density;
          if (!_.isUndefined(set)) { 
            if (!d.line) { d.line = {}; }
            return d.line[key] = set;
          }
          return d.line && d.line[key]; 
        };
        
        function success(data) {
          var drawSpec = [], 
            lines, intervals, calcPixInterval;
          if (density == 'dense') {
            lines = data.split(/\s+/g);
            _.each(lines, function(line, x) { 
              if (line != 'n/a' && line.length) { drawSpec.push({x: x, w: 1, v: parseFloat(line) * 1000}); } 
            });
          } else {
            lines = _.filter(data.split('\n'), function(l) { var m = l.match(/\t/g); return m && m.length >= 2; });
            intervals = _.map(lines, function(l) { return {data: self.type('bed').parseLine.call(self, l)}; });
            calcPixInterval = new CustomTrack.pixIntervalCalculator(start, width, bppp, density=='pack');
            drawSpec = self.type('bed').stackedLayout.call(self, intervals, width, calcPixInterval);
          }
          callback(drawSpec);
        }
      
        $.ajax(this.ajaxDir() + 'bigbed.php', {
          data: {range: range, url: this.opts.bigDataUrl, width: width, density: density},
          success: success
        });
      },
    
      render: function(canvas, start, end, density, callback) {
        var self = this;
        self.prerender(start, end, density, {width: canvas.width}, function(drawSpec) {
          self.type('bed').drawSpec.call(self, canvas, drawSpec, density);
          _.isFunction(callback) && callback();
        });
      },
      
      loadOpts: function() { return this.type('bed').loadOpts.apply(this, arguments); },
      
      saveOpts: function() { return this.type('bed').saveOpts.apply(this, arguments); }
    },
    
    // =====================================================================
    // = bigWig format: http://genome.ucsc.edu/goldenPath/help/bigWig.html =
    // =====================================================================
  
    bigwig: {
      defaults: {
        altColor: '128,128,128',
        priority: 100,
        autoScale: 'on',
        alwaysZero: 'off',
        gridDefault: 'off',
        maxHeightPixels: '128:128:15',
        graphType: 'bar',
        viewLimits: '',
        yLineMark: 0.0,
        yLineOnOff: 'off',
        windowingFunction: 'maximum',
        smoothingWindow: 'off'
      },
    
      init: function() {
        if (!this.opts.bigDataUrl) {
          throw new Error("Required parameter bigDataUrl not found for bigWig track at " + JSON.stringify(this.opts) + (this.opts.lineNum + 1));
        }
        this.type('wiggle_0').initOpts.call(this);
      },
      
      _binFunctions: {'minimum':1, 'maximum':1, 'mean':1, 'min':1, 'max':1, 'std':1, 'coverage':1},
      
      applyOpts: function() { return this.type('wiggle_0').applyOpts.apply(this, arguments); },
    
      parse: function(lines) {
        var self = this;
        self.stretchHeight = true;
        self.range = self.isOn(self.opts.alwaysZero) ? [0, 0] : [Infinity, -Infinity];
        $.ajax(self.ajaxDir() + 'bigwig.php', {
          data: {info: 1, url: this.opts.bigDataUrl},
          async: false,  // This is cool since parsing normally happens in a Web Worker
          success: function(data) {
            var rows = data.split("\n");
            _.each(rows, function(r) {
              var keyval = r.split(': ');
              if (keyval[0]=='min') { self.range[0] = Math.min(parseFloat(keyval[1]), self.range[0]); }
              if (keyval[0]=='max') { self.range[1] = Math.max(parseFloat(keyval[1]), self.range[1]); }
            });
          }
        });
        self.type('wiggle_0').applyOpts.apply(self);
        return true;
      },
    
      prerender: function(start, end, density, precalc, callback) {
        var self = this,
          width = precalc.width,
          chrRange = self.chrRange(start, end);
      
        function success(data) {
          var drawSpec = self.type('wiggle_0').initDrawSpec.call(self, precalc),
            lines = data.split(/\s+/g);
          _.each(lines, function(line) {
            if (line == 'n/a') { drawSpec.bars.push(null); }
            else if (line.length) { drawSpec.bars.push((parseFloat(line) - self.drawRange[0]) / drawSpec.vScale); }
          });
          callback(drawSpec);
        }
      
        $.ajax(self.ajaxDir() + 'bigwig.php', {
          data: {range: chrRange, url: self.opts.bigDataUrl, width: width, winFunc: self.opts.windowingFunction},
          success: success
        });
      },
    
      render: function(canvas, start, end, density, callback) {
        var self = this,
          height = canvas.height,
          width = canvas.width,
          ctx = canvas.getContext && canvas.getContext('2d');
        if (!ctx) { throw "Canvas not supported"; }
        self.prerender(start, end, density, {width: width, height: height}, function(drawSpec) {
          self.type('wiggle_0').drawBars.call(self, ctx, drawSpec, height, width);
          _.isFunction(callback) && callback();
        });
      },

      loadOpts: function() { return this.type('wiggle_0').loadOpts.apply(this, arguments); },

      saveOpts: function() { return this.type('wiggle_0').saveOpts.apply(this, arguments); }
    }
  
  };

  // These functions branch to different methods depending on the .type() of the track
  _.each(['init', 'parse', 'render', 'prerender'], function(fn) {
    CustomTrack.prototype[fn] = function() {
      var args = _.toArray(arguments),
        type = this.type();
      if (!type[fn]) { return false; }
      return type[fn].apply(this, args);
    }
  });
  
  CustomTrack.prototype.loadOpts = function($dialog) {
    var type = this.type(),
      o = this.opts;
    $dialog.find('.custom-opts-form').hide();
    $dialog.find('.custom-opts-form.'+this._type).show();
    $dialog.find('.custom-name').text(o.name);
    $dialog.find('.custom-desc').text(o.description);
    $dialog.find('.custom-format').text(this._type);
    $dialog.find('[name=color]').val(o.color).change();
    if (type.loadOpts) { type.loadOpts.call(this, $dialog); }
    $dialog.find('.enabler').change();
  };
  
  CustomTrack.prototype.saveOpts = function($dialog) {
    var type = this.type(),
      o = this.opts;
    o.color = $dialog.find('[name=color]').val();
    if (!this.validateColor(o.color)) { o.color = '0,0,0'; }
    if (type.saveOpts) { type.saveOpts.call(this, $dialog); }
    this.applyOpts();
    CustomTracks.worker() && this.applyOptsAsync(); // Apply the changes to the worker too!
  };
  
  CustomTrack.prototype.applyOpts = function(opts) {
    var type = this.type();
    if (opts) { this.opts = opts; }
    if (type.applyOpts) { type.applyOpts.call(this); }
  };

  CustomTrack.prototype.erase = function(canvas) {
    var self = this,
      ctx = canvas.getContext && canvas.getContext('2d');
    if (ctx) { ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }

  CustomTrack.prototype.type = function(type) {
    if (_.isUndefined(type)) { type = this._type; }
    return this.constructor.types[type] || null;
  };
  
  CustomTrack.prototype.warn = function(warning) {
    if (this.opts.strict) {
      throw new Error(warning);
    } else {
      if (!this.warnings) { this.warnings = []; }
      this.warnings.push(warning);
    }
  };

  CustomTrack.prototype.isOn = function(val) {
    return /^(on|yes|true|t|y|1)$/i.test(val.toString());
  };

  CustomTrack.prototype.chrList = function() {
    if (!this._chrList) {
      this._chrList = _.sortBy(_.map(this.browserOpts.chrPos, function(pos, chr) { return [pos, chr]; }), function(v) { return v[0]; });
    }
    return this._chrList;
  }

  CustomTrack.prototype.chrAt = function(pos) {
    var chrList = this.chrList(),
      chrIndex = _.sortedIndex(chrList, [pos], function(v) { return v[0]; }),
      chr = chrIndex > 0 ? chrList[chrIndex - 1][1] : null;
    return {i: chrIndex - 1, c: chr, p: pos - this.browserOpts.chrPos[chr]};
  };

  CustomTrack.prototype.chrRange = function(start, end) {
    var chrLengths = this.browserOpts.chrLengths,
      startChr = this.chrAt(start),
      endChr = this.chrAt(end),
      range;
    if (startChr.c && startChr.i === endChr.i) { return [startChr.c + ':' + startChr.p + '-' + endChr.p]; }
    else {
      range = _.map(this.chrList().slice(startChr.i + 1, endChr.i), function(v) {
        return v[1] + ':1-' + chrLengths[v[1]];
      });
      startChr.c && range.unshift(startChr.c + ':' + startChr.p + '-' + chrLengths[startChr.c]);
      endChr.c && range.push(endChr.c + ':1-' + endChr.p);
      return range;
    }
  }

  CustomTrack.prototype.prerenderAsync = function() {
    CustomTracks.async(this, 'prerender', arguments, [this.id]);
  };
  
  CustomTrack.prototype.applyOptsAsync = function() {
    CustomTracks.async(this, 'applyOpts', [this.opts, function(){}], [this.id]);
  };

  CustomTrack.prototype.ajaxDir = function() {
    // Web Workers fetch URLs relative to the JS file itself.
    return (global.HTMLDocument ? '' : '../') + this.browserOpts.ajaxDir;
  };

  CustomTrack.prototype.rgbToHsl = function(r, g, b) {
    r /= 255, g /= 255, b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;

    if (max == min) {
      h = s = 0; // achromatic
    } else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch(max){
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }

    return [h, s, l];
  }
  
  CustomTrack.prototype.hslToRgb = function(h, s, l) {
    var r, g, b;

    if (s == 0) {
      r = g = b = l; // achromatic
    } else {
      function hue2rgb(p, q, t) {
        if(t < 0) t += 1;
        if(t > 1) t -= 1;
        if(t < 1/6) return p + (q - p) * 6 * t;
        if(t < 1/2) return q;
        if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      }

      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }

    return [r * 255, g * 255, b * 255];
  }
  
  CustomTrack.prototype.validateColor = function(color) {
    var m = color.match(/(\d+),(\d+),(\d+)/);
    if (!m) { return false; }
    m.shift();
    return _.all(_.map(m, parseInt10), function(v) { return v >=0 && v <= 255; });
  }

  global.CustomTracks = CustomTracks;

})(this);