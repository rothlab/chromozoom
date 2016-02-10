(function(global){
  
  // Some utility functions.

  // Parse a track declaration line, which is in the format of:
  // track name="blah" optname1="value1" optname2="value2" ...
  // into a hash of options
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
  
  function strip(str) { return str.replace(/^\s+|\s+$/g, ''); }

  // Faster than Math.floor (http://webdood.com/?p=219)
  function floorHack(num) { return (num << 0) - (num < 0 ? 1 : 0); }

  function parseInt10(val) { return parseInt(val, 10); }

  // ========================================================================
  // = CustomTracks, the module that is exported to the global environment. =
  // ========================================================================

  var CustomTracks = {
    parse: function(chunks, browserOpts) {
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
      });
      if (track) { pushTrack(); }
      return customTracks;
    },
    
    parseDeclarationLine: parseDeclarationLine,
    
    error: function(e) {
      // Can be overridden by a parent library to handle errors more gracefully.
      console.log(e);
    },
    
    _workerScript: 'js/CustomTrackWorker.js',
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
      this.async(this, 'parse', arguments, [], function(tracks) {
        // These have been serialized, so they must be hydrated into real CustomTrack objects.
        // We replace .prerender() with an asynchronous version.
        return _.map(tracks, function(t) {
          return _.extend(new CustomTrack(), t, {
            prerender: function() { CustomTrack.prototype.prerenderAsync.apply(this, arguments); }
          });
        });
      });
    }
  };

  // ==============================================================================================
  // = LineMask: A (very cheap) alternative to IntervalTree: a small, 1D pixel buffer of objects. =
  // ==============================================================================================

  function LineMask(width, fudge) {
    this.fudge = fudge = (fudge || 1);
    this.items = [];
    this.length = Math.ceil(width / fudge);
    this.mask = global.Uint8Array ? new Uint8Array(this.length) : new Array(this.length);
  }

  LineMask.prototype.add = function(x, w, data) {
    var upTo = Math.ceil((x + w) / this.fudge);
    this.items.push({x: x, w: w, data: data});
    for (var i = Math.max(floorHack(x / this.fudge), 0); i < Math.min(upTo, this.length); i++) { this.mask[i] = 1; }
  };

  LineMask.prototype.conflict = function(x, w) {
    var upTo = Math.ceil((x + w) / this.fudge);
    for (var i = Math.max(floorHack(x / this.fudge), 0); i < Math.min(upTo, this.length); i++) { if (this.mask[i]) return true; }
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
      areas: {},
      noAreaLabels: false,
      expectsSequence: false
    });
    this.init();
  }

  CustomTrack.defaults = {
    name: 'User Track',
    description: 'User Supplied Track',
    color: '0,0,0'
  };

  // Constructs a mapping function that converts bp intervals into pixel intervals, with optional calculations for text too
  CustomTrack.pixIntervalCalculator = function(start, width, bppp, withText, nameFunc, startkey, endkey) {
    if (!_.isFunction(nameFunc)) { nameFunc = function(d) { return d.name || ''; }; }
    if (_.isUndefined(startkey)) { startkey = 'start'; }
    if (_.isUndefined(endkey)) { endkey = 'end'; }
    return function(d) {
      var pInt = {
        x: Math.round((d[startkey] - start) / bppp),
        w: Math.round((d[endkey] - d[startkey]) / bppp) + 1,
        t: 0,          // calculated width of text
        oPrev: false,  // overflows into previous tile?
        oNext: false   // overflows into next tile?
      };
      pInt.tx = pInt.x;
      pInt.tw = pInt.w;
      if (pInt.x < 0) { pInt.w += pInt.x; pInt.x = 0; pInt.oPrev = true; }
      else if (withText) { 
        pInt.t = Math.min(nameFunc(d).length * 10 + 2, pInt.x);
        pInt.tx -= pInt.t;
        pInt.tw += pInt.t;  
      }
      if (pInt.x + pInt.w > width) { pInt.w = width - pInt.x; pInt.oNext = true; }
      return pInt;
    };
  };
  
  // For two given objects of the form {x: 1, w: 2} (pixel intervals), describe the overlap.
  // Returns null if there is no overlap.
  CustomTrack.pixIntervalOverlap = function(pInt1, pInt2) {
    var overlap = {},
      tmp;
    if (pInt1.x > pInt2.x) { tmp = pInt2; pInt2 = pInt1; pInt1 = tmp; }       // swap so that pInt1 is always lower
    if (!pInt1.w || !pInt2.w || pInt1.x + pInt1.w < pInt2.x) { return null; } // detect no-overlap conditions
    overlap.x = pInt2.x;
    overlap.w = Math.min(pInt1.w - pInt2.x + pInt1.x, pInt2.w);
    return overlap;
  };

  CustomTrack.wigBinFunctions = {
    minimum: function(bin) { return bin.length ? Math.min.apply(Math, bin) : 0; },
    mean: function(bin) { return _.reduce(bin, function(a,b) { return a + b; }, 0) / bin.length; },
    maximum: function(bin) { return bin.length ? Math.max.apply(Math, bin) : 0; }
  };

  CustomTrack.types = {
  
    /*
      A few quick notes on setting up a format.
    
      + The type name must be lowercase, e.g. beddetail despite `track type=bedDetail`
    
      + .parse(), .prerender(), and .render() MUST be defined.
    
      + .renderWithSequence() SHOULD be defined for formats that draw things based on the nucleotide sequence, which may arrive
        later than the initial render request.
      
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

      + .renderSequence() has access to the same object space as .render(), and MAY call .prerender() in the same fashion as
        .render(). If it has to draw certain objects *after* .render() (i.e., on top of what .render() drew), it must use the state
        of the canvas to check for this and register callbacks as necessary, since although .render() is guaranteed to be called
        before .renderSequence(), it is asynchronous and may draw things on the canvas at any time afterward. See the "bam"
        format for an example of how to do this.
      
      + start and end, as passed to .render(), are 1-based from the start of the genome and right-open intervals, following the 
        genobrowser convention.
    */
  
    // =================================================================
    // = BED format: http://genome.ucsc.edu/FAQ/FAQformat.html#format1 =
    // =================================================================
    //
    // bedDetail is a trivial extension of BED that is defined separately,
    // although a BED file with >12 columns is assumed to be bedDetail track regardless of type.
  
    bed: {
      defaults: {
        itemRgb: 'off',
        colorByStrand: '',
        useScore: 0,
        group: 'user',
        priority: 'user',
        offset: 0,
        detail: false,
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
          'blockCount', 'blockSizes', 'blockStarts', 'id', 'description'],
          feature = {},
          fields = /\t/.test(line) ? line.split("\t") : line.split(/\s+/),
          chrPos, blockSizes;
        
        if (this.opts.detail) {
          cols[fields.length - 2] = 'id';
          cols[fields.length - 1] = 'description';
        }
        _.each(fields, function(v, i) { feature[cols[i]] = v; });
        chrPos = this.browserOpts.chrPos[feature.chrom];
        lineno = lineno || 0;
        
        if (_.isUndefined(chrPos)) { 
          this.warn("Invalid chromosome '"+feature.chrom+"' at line " + (lineno + 1 + this.opts.lineNum));
          return null;
        } else {
          feature.score = _.isUndefined(feature.score) ? '?' : feature.score;
          feature.start = chrPos + parseInt10(feature.chromStart) + 1;
          feature.end = chrPos + parseInt10(feature.chromEnd) + 1;
          feature.blocks = null;
          // fancier BED features to express coding regions and exons/introns
          if (/^\d+$/.test(feature.thickStart) && /^\d+$/.test(feature.thickEnd)) {
            feature.thickStart = chrPos + parseInt10(feature.thickStart) + 1;
            feature.thickEnd = chrPos + parseInt10(feature.thickEnd) + 1;
            if (/^\d+(,\d*)*$/.test(feature.blockSizes) && /^\d+(,\d*)*$/.test(feature.blockStarts)) {
              feature.blocks = [];
              blockSizes = feature.blockSizes.split(/,/);
              _.each(feature.blockStarts.split(/,/), function(start, i) {
                if (start === '') { return; }
                var block = {start: feature.start + parseInt10(start)};
                block.end = block.start + parseInt10(blockSizes[i]);
                feature.blocks.push(block);
              });
            }
          } else {
            feature.thickStart = feature.thickEnd = null;
          }
        }
        
        return feature;
      },
    
      parse: function(lines) {
        var self = this,
          middleishPos = self.browserOpts.genomeSize / 2,
          data = new IntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'});
        _.each(lines, function(line, lineno) {
          var feature = self.type().parseLine.call(self, line, lineno);
          if (feature) { data.add(feature); }
        });
        self.data = data;
        self.heights = {max: null, min: 15, start: 15};
        self.sizes = ['dense', 'squish', 'pack'];
        self.mapSizes = ['pack'];
        return true;
      },
      
      stackedLayout: function(intervals, width, calcPixInterval, lineNum) {
        // A lineNum function can be provided which can set/retrieve the line of already rendered datapoints
        // so as to not break a ranged feature that extends over multiple tiles.
        lineNum = _.isFunction(lineNum) ? lineNum : function() { return; };
        var lines = [],
          maxExistingLine = _.max(_.map(intervals, function(v) { return lineNum(v.data) || 0; })) + 1,
          sortedIntervals = _.sortBy(intervals, function(v) { var ln = lineNum(v.data); return _.isUndefined(ln) ? 1 : -ln; });
        
        while (maxExistingLine-->0) { lines.push(new LineMask(width, 5)); }
        _.each(sortedIntervals, function(v) {
          var d = v.data,
            ln = lineNum(d),
            pInt = calcPixInterval(d),
            thickInt = d.thickStart !== null && calcPixInterval({start: d.thickStart, end: d.thickEnd}),
            blockInts = d.blocks !== null &&  _.map(d.blocks, calcPixInterval),
            i = 0,
            l = lines.length;
          if (!_.isUndefined(ln)) {
            if (lines[ln].conflict(pInt.tx, pInt.tw)) { /*throw "Unresolvable LineMask conflict!";*/ }
            lines[ln].add(pInt.tx, pInt.tw, {pInt: pInt, thickInt: thickInt, blockInts: blockInts, d: d});
          } else {
            while (i < l && lines[i].conflict(pInt.tx, pInt.tw)) { ++i; }
            if (i == l) { lines.push(new LineMask(width, 5)); }
            lineNum(d, i);
            lines[i].add(pInt.tx, pInt.tw, {pInt: pInt, thickInt: thickInt, blockInts: blockInts, d: d});
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
            return (d.line[key] = set);
          }
          return d.line && d.line[key]; 
        }
        
        if (density == 'dense') {
          _.each(intervals, function(v) {
            var pInt = calcPixInterval(v.data);
            pInt.v = v.data.score;
            drawSpec.push(pInt);
          });
        } else {
          drawSpec = {layout: this.type('bed').stackedLayout.call(this, intervals, width, calcPixInterval, lineNum)};
          drawSpec.width = width;
        }
        return _.isFunction(callback) ? callback(drawSpec) : drawSpec;
      },
      
      addArea: function(areas, data, i, lineHeight, urlTemplate) {
        var tipTipData = {},
          tipTipDataCallback = this.type().tipTipData;
        if (!areas) { return; }
        if (_.isFunction(tipTipDataCallback)) {
          tipTipData = tipTipDataCallback(data);
        } else {
          if (!_.isUndefined(data.d.description)) { tipTipData.description = data.d.description; }
          if (!_.isUndefined(data.d.score)) { tipTipData.score = data.d.score; }
          _.extend(tipTipData, {
            position: data.d.chrom + ':' + data.d.chromStart, 
            size: data.d.chromEnd - data.d.chromStart
          });
          // Display the ID column (from bedDetail), unless it contains a tab character, which means it was autogenerated
          if (!_.isUndefined(data.d.id) && !(/\t/).test(data.d.id)) { tipTipData.id = data.d.id; }
        }
        areas.push([
          data.pInt.x, i * lineHeight + 1, data.pInt.x + data.pInt.w, (i + 1) * lineHeight, // x1, x2, y1, y2
          data.d.name || data.d.id || '',                                                   // name
          urlTemplate.replace('$$', _.isUndefined(data.d.id) ? data.d.name : data.d.id),    // href
          data.pInt.oPrev,                                                                  // continuation from previous tile?
          null,
          null,
          tipTipData
        ]);
      },
      
      // Scales a score from 0-1000 into an alpha value between 0.2 and 1.0
      calcAlpha: function(value) { return Math.max(value, 166)/1000; },
      
      // Scales a score from 0-1000 into a color scaled between #cccccc and max Color
      calcGradient: function(maxColor, value) {
        var minColor = [230,230,230],
          valueColor = [];
        if (!_.isArray(maxColor)) { maxColor = _.map(maxColor.split(','), parseInt10); }
        _.each(minColor, function(v, i) { valueColor[i] = (v - maxColor[i]) * ((1000 - value) / 1000.0) + maxColor[i]; });
        return _.map(valueColor, parseInt10).join(',');
      },
      
      drawArrows: function(ctx, canvasWidth, lineY, halfHeight, startX, endX, direction) {
        var arrowHeight = Math.min(halfHeight, 3),
          X1, X2;
        startX = Math.max(startX, 0);
        endX = Math.min(endX, canvasWidth);
        if (endX - startX < 5) { return; } // can't draw arrows in that narrow of a space
        if (direction !== '+' && direction !== '-') { return; } // invalid direction
        ctx.beginPath();
        // All the 0.5's here are due to <canvas>'s somewhat silly coordinate system 
        // http://diveintohtml5.info/canvas.html#pixel-madness
        X1 = direction == '+' ? 0.5 : arrowHeight + 0.5;
        X2 = direction == '+' ? arrowHeight + 0.5 : 0.5;
        for (var i = Math.floor(startX) + 2; i < endX - arrowHeight; i += 7) {
          ctx.moveTo(i + X1, lineY + halfHeight - arrowHeight + 0.5);
          ctx.lineTo(i + X2, lineY + halfHeight + 0.5);
          ctx.lineTo(i + X1, lineY + halfHeight + arrowHeight + 0.5);
        }
        ctx.stroke();
      },
      
      drawFeature: function(ctx, width, data, i, lineHeight) {
        var self = this,
          color = self.opts.color,
          y = i * lineHeight,
          halfHeight = Math.round(0.5 * (lineHeight - 1)),
          quarterHeight = Math.ceil(0.25 * (lineHeight - 1)),
          lineGap = lineHeight > 6 ? 2 : 1,
          thickOverlap = null,
          prevBInt = null;
        
        // First, determine and set the color we will be using
        // Note that the default color was already set in drawSpec
        if (self.opts.altColor && data.d.strand == '-') { color = self.opts.altColor; }
        
        if (self.opts.itemRgb && data.d.itemRgb && this.validateColor(data.d.itemRgb)) { color = data.d.itemRgb; }
        
        if (self.opts.useScore) { color = self.type('bed').calcGradient(color, data.d.score); }
        
        if (self.opts.itemRgb || self.opts.altColor || self.opts.useScore) { ctx.fillStyle = ctx.strokeStyle = "rgb(" + color + ")"; }
        
        if (data.thickInt) {
          // The coding region is drawn as a thicker line within the gene
          if (data.blockInts) {
            // If there are exons and introns, draw the introns with a 1px line
            prevBInt = null;
            ctx.fillRect(data.pInt.x, y + halfHeight, data.pInt.w, 1);
            ctx.strokeStyle = color;
            _.each(data.blockInts, function(bInt) {
              if (bInt.x + bInt.w <= width && bInt.x >= 0) {
                ctx.fillRect(bInt.x, y + halfHeight - quarterHeight + 1, bInt.w, quarterHeight * 2 - 1);
              }
              thickOverlap = CustomTrack.pixIntervalOverlap(bInt, data.thickInt);
              if (thickOverlap) {
                ctx.fillRect(thickOverlap.x, y + 1, thickOverlap.w, lineHeight - lineGap);
              }
              // If there are introns, arrows are drawn on the introns, not the exons...
              if (data.d.strand && prevBInt) {
                ctx.strokeStyle = "rgb(" + color + ")";
                self.type('bed').drawArrows(ctx, width, y, halfHeight, prevBInt.x + prevBInt.w, bInt.x, data.d.strand);
              }
              prevBInt = bInt;
            });
            // ...unless there were no introns. Then it is drawn on the coding region.
            if (data.blockInts.length == 1) {
              ctx.strokeStyle = "white";
              self.type('bed').drawArrows(ctx, width, y, halfHeight, data.thickInt.x, data.thickInt.x + data.thickInt.w, data.d.strand);
            }
          } else {
            // We have a coding region but no introns/exons
            ctx.fillRect(data.pInt.x, y + halfHeight - quarterHeight + 1, data.pInt.w, quarterHeight * 2 - 1);
            ctx.fillRect(data.thickInt.x, y + 1, data.thickInt.w, lineHeight - lineGap);
            ctx.strokeStyle = "white";
            self.type('bed').drawArrows(ctx, width, y, halfHeight, data.thickInt.x, data.thickInt.x + data.thickInt.w, data.d.strand);
          }
        } else {
          // Nothing fancy.  It's a box.
          ctx.fillRect(data.pInt.x, y + 1, data.pInt.w, lineHeight - lineGap);
          ctx.strokeStyle = "white";
          self.type('bed').drawArrows(ctx, width, y, halfHeight, data.pInt.x, data.pInt.x + data.pInt.w, data.d.strand);
        }
      },
      
      drawSpec: function(canvas, drawSpec, density) {
        var self = this,
          ctx = canvas.getContext && canvas.getContext('2d'),
          urlTemplate = self.opts.url ? self.opts.url : 'javascript:void("'+self.opts.name+':$$")',
          drawLimit = self.opts.drawLimit && self.opts.drawLimit[density],
          lineHeight = density == 'pack' ? 15 : 6,
          color = self.opts.color,
          areas = null;
        
        if (!ctx) { throw "Canvas not supported"; }
        // TODO: I disabled regenerating areas here, which assumes that lineNum remains stable across re-renders. Should check on this.
        if (density == 'pack' && !self.areas[canvas.id]) { areas = self.areas[canvas.id] = []; }
        
        if (density == 'dense') {
          canvas.height = 15;
          ctx.fillStyle = "rgb("+color+")";
          _.each(drawSpec, function(pInt) {
            if (self.opts.useScore) { ctx.fillStyle = "rgba("+self.type('bed').calcGradient(color, pInt.v)+")"; }
            ctx.fillRect(pInt.x, 1, pInt.w, 13);
          });
        } else {
          if ((drawLimit && drawSpec.layout && drawSpec.layout.length > drawLimit) || drawSpec.tooMany) { 
            canvas.height = 0;
            // This applies styling that indicates there was too much data to load/draw and that the user needs to zoom to see more
            canvas.className = canvas.className + ' too-many';
            return;
          }
          canvas.height = drawSpec.layout.length * lineHeight;
          ctx.fillStyle = ctx.strokeStyle = "rgb("+color+")";
          _.each(drawSpec.layout, function(l, i) {
            _.each(l, function(data) {
              self.type('bed').drawFeature.call(self, ctx, drawSpec.width, data, i, lineHeight);              
              self.type('bed').addArea.call(self, areas, data, i, lineHeight, urlTemplate);
            });
          });
        }
      },
    
      render: function(canvas, start, end, density, callback) {
        var self = this;
        self.prerender(start, end, density, {width: canvas.width}, function(drawSpec) {
          self.type().drawSpec.call(self, canvas, drawSpec, density);
          if (_.isFunction(callback)) { callback(); }
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
    
    // ======================================================================
    // = featureTable format: http://www.insdc.org/files/feature_table.html =
    // ======================================================================
    
    featuretable: {
      defaults: {
        collapseByGene: 'off',
        keyColumnWidth: 21,
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
        this.type('bed').initOpts.call(this);
        this.opts.collapseByGene = this.isOn(this.opts.collapseByGene);
        this.featureTypeCounts = {};
      },
      
      // parses one feature key + location/qualifiers row from the feature table
      parseEntry: function(chrom, lines, startLineNo) {
        var feature = {
            chrom: chrom,
            score: '?',
            blocks: null,
            qualifiers: {}
          },
          keyColumnWidth = this.opts.keyColumnWidth,
          qualifier = null,
          fullLocation = [],
          collapseKeyQualifiers = ['locus_tag', 'gene', 'db_xref'],
          qualifiersThatAreNames = ['gene', 'locus_tag', 'db_xref'],
          RNATypes = ['rrna', 'trna'],
          alsoTryForRNATypes = ['product'],
          locationPositions, chrPos, blockSizes;
        
        chrPos = this.browserOpts.chrPos[chrom];
        startLineNo = startLineNo || 0;
        if (_.isUndefined(chrPos)) {
          this.warn("Invalid chromosome at line " + (lineno + 1 + this.opts.lineNum));
          return null;
        }
        
        // fill out feature's keys with info from these lines
        _.each(lines, function(line, lineno) {
          var key = line.substr(0, keyColumnWidth),
            restOfLine = line.substr(keyColumnWidth),
            qualifierMatch = restOfLine.match(/^\/(\w+)(=?)(.*)/);
          if (key.match(/\w/)) {
            feature.type = strip(key);
            qualifier = null;
            fullLocation.push(restOfLine);
          } else {
            if (qualifierMatch) {
              qualifier = qualifierMatch[1];
              if (!feature.qualifiers[qualifier]) { feature.qualifiers[qualifier] = []; }
              feature.qualifiers[qualifier].push([qualifierMatch[2] ? qualifierMatch[3] : true]);
            } else {
              if (qualifier !== null) { 
                _.last(feature.qualifiers[qualifier]).push(restOfLine);
              } else {
                fullLocation.push(restOfLine);
              }
            }
          }
        });
        
        feature.fullLocation = fullLocation = fullLocation.join('');
        locationPositions = _.map(_.filter(fullLocation.split(/\D+/), _.identity), parseInt10);
        feature.chromStart =  _.min(locationPositions);
        feature.chromEnd = _.max(locationPositions) + 1; // Feature table ranges are *inclusive* of the end base
                                                         // chromEnd columns in BED format are *not*.
        feature.start = chrPos + feature.chromStart;
        feature.end = chrPos + feature.chromEnd; 
        feature.strand = /complement/.test(fullLocation) ? "-" : "+";
        
        // Until we merge by gene name, we don't care about these
        feature.thickStart = feature.thickEnd = null;
        feature.blocks = null;
        
        // Parse the qualifiers properly
        _.each(feature.qualifiers, function(v, k) {
          _.each(v, function(entryLines, i) {
            v[i] = strip(entryLines.join(' '));
            if (/^"[\s\S]*"$/.test(v[i])) {
              // Dequote free text
              v[i] = v[i].replace(/^"|"$/g, '').replace(/""/g, '"');
            }
          });
          //if (v.length == 1) { feature.qualifiers[k] = v[0]; }
        });
        
        // Find something that can serve as a name
        feature.name = feature.type;
        if (_.contains(RNATypes, feature.type.toLowerCase())) { 
          Array.prototype.push.apply(qualifiersThatAreNames, alsoTryForRNATypes); 
        }
        _.find(qualifiersThatAreNames, function(k) {
          if (feature.qualifiers[k] && feature.qualifiers[k][0]) { return (feature.name = feature.qualifiers[k][0]); }
        });
        // In the worst case, add a counter to disambiguate features named only by type
        if (feature.name == feature.type) {
          if (!this.featureTypeCounts[feature.type]) { this.featureTypeCounts[feature.type] = 1; }
          feature.name = feature.name + '_' + this.featureTypeCounts[feature.type]++;
        }
        
        // Find a key that is appropriate for collapsing
        if (this.opts.collapseByGene) {
          _.find(collapseKeyQualifiers, function(k) {
            if (feature.qualifiers[k] && feature.qualifiers[k][0]) { 
              return (feature._collapseKey = feature.qualifiers[k][0]);
            }
          });
        }
        
        return feature;
      },
      
      // collapses multiple features that are about the same gene into one drawable feature
      collapseFeatures: function(features) {
        var chrPos = this.browserOpts.chrPos,
          preferredTypeToMergeInto = ['mrna', 'gene', 'cds'],
          preferredTypeForExons = ['exon', 'cds'],
          mergeInto = features[0],
          blocks = [],
          foundType, cds, exons;
        foundType = _.find(preferredTypeToMergeInto, function(type) {
          var found = _.find(features, function(feat) { return feat.type.toLowerCase() == type; });
          if (found) { mergeInto = found; return true; }
        });
        
        // Look for exons (eukaryotic) or a CDS (prokaryotic)
        _.find(preferredTypeForExons, function(type) {
          exons = _.select(features, function(feat) { return feat.type.toLowerCase() == type; });
          if (exons.length) { return true; }
        });
        cds = _.find(features, function(feat) { return feat.type.toLowerCase() == "cds"; });
        
        _.each(exons, function(exonFeature) {
          exonFeature.fullLocation.replace(/(\d+)\.\.[><]?(\d+)/g, function(fullMatch, start, end) {
            blocks.push({
              start: chrPos[exonFeature.chrom] + Math.min(start, end), 
              // Feature table ranges are *inclusive* of the end base.
              end: chrPos[exonFeature.chrom] +  Math.max(start, end) + 1
            });
          });
        });
        
        // Convert exons and CDS into blocks, thickStart and thickEnd (in BED terminology)
        if (blocks.length) { 
          mergeInto.blocks = _.sortBy(blocks, function(b) { return b.start; });
          mergeInto.thickStart = cds ? cds.start : feature.start;
          mergeInto.thickEnd = cds ? cds.end : feature.end;
        }
        
        // finally, merge all the qualifiers
        _.each(features, function(feat) {
          if (feat === mergeInto) { return; }
          _.each(feat.qualifiers, function(values, k) {
            if (!mergeInto.qualifiers[k]) { mergeInto.qualifiers[k] = []; }
            _.each(values, function(v) {
              if (!_.contains(mergeInto.qualifiers[k], v)) { mergeInto.qualifiers[k].push(v); }
            });
          });
        });
        
        return mergeInto;
      },
    
      parse: function(lines) {
        var self = this,
          o = self.opts,
          middleishPos = this.browserOpts.genomeSize / 2,
          data = new IntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'}),
          numLines = lines.length,
          chrom = null,
          lastEntryStart = null,
          featuresByCollapseKey = {},
          feature;
        
        function collectLastEntry(lineno) {
          if (lastEntryStart !== null) {
            feature = self.type().parseEntry.call(self, chrom, lines.slice(lastEntryStart, lineno), lastEntryStart);
            if (feature) { 
              if (o.collapseByGene) {
                featuresByCollapseKey[feature._collapseKey] = featuresByCollapseKey[feature._collapseKey] || [];
                featuresByCollapseKey[feature._collapseKey].push(feature);
              } else { data.add(feature); }
            }
          }
        }
        
        // Chunk the lines into entries and parse each of them
        _.each(lines, function(line, lineno) {
          if (line.substr(0, 12) == "ACCESSION   ") {
            collectLastEntry(lineno);
            chrom = line.substr(12);
            lastEntryStart = null;
          } else if (chrom !== null && line.substr(5, 1).match(/\w/)) {
            collectLastEntry(lineno);
            lastEntryStart = lineno;
          }
        });
        // parse the last entry
        if (chrom !== null) { collectLastEntry(lines.length); }
        
        if (o.collapseByGene) {
          _.each(featuresByCollapseKey, function(features, gene) {
            data.add(self.type().collapseFeatures.call(self, features));
          });
        }
        
        self.data = data;
        self.heights = {max: null, min: 15, start: 15};
        self.sizes = ['dense', 'squish', 'pack'];
        self.mapSizes = ['pack'];
        return true;
      },
      
      // special formatter for content in tooltips for features
      tipTipData: function(data) {
        var qualifiersToAbbreviate = {translation: 1},
          content = {
            type: data.d.type,
            position: data.d.chrom + ':' + data.d.chromStart, 
            size: data.d.chromEnd - data.d.chromStart
          };
        if (data.d.qualifiers.note && data.d.qualifiers.note[0]) {  }
        _.each(data.d.qualifiers, function(v, k) {
          if (k == 'note') { content.description = v.join('; '); return; }
          content[k] = v.join('; ');
          if (qualifiersToAbbreviate[k] && content[k].length > 25) { content[k] = content[k].substr(0, 25) + '...'; }
        });
        return content;
      },
      
      prerender: function(start, end, density, precalc, callback) {
        return this.type('bed').prerender.call(this, start, end, density, precalc, callback);
      },
      
      drawSpec: function() { return this.type('bed').drawSpec.apply(this, arguments); },
      
      render: function(canvas, start, end, density, callback) {
        this.type('bed').render.call(this, canvas, start, end, density, callback);
      },
      
      loadOpts: function() { return this.type('bed').loadOpts.apply(this, arguments); },
      
      saveOpts: function() { return this.type('bed').saveOpts.apply(this, arguments); }
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
          
          m = line.match(/^(variable|fixed)Step\s+/i);
          if (m) {
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
          binFunction = self.type()._binFunctions[self.opts.windowingFunction];
        if (data.all.length > 0) {
          self.range[0] = _.min(data.all, function(d) { return d.val; }).val;
          self.range[1] = _.max(data.all, function(d) { return d.val; }).val;
        }
        data.all = new SortedList(data.all, {
          compare: function(a, b) {
            if (a === null) return -1;
            if (b === null) return  1;
            var c = a.start - b.start;
            return (c > 0) ? 1 : (c === 0)  ? 0 : -1;
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
          binFunction = self.type()._binFunctions[self.opts.windowingFunction],
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
        var zeroLine = drawSpec.zeroLine, // pixel position of the data value 0
          color = "rgb("+this.opts.color+")",
          altColor = "rgb("+(this.opts.altColor || this.altColor)+")",
          pointGraph = this.opts.graphType==='points';
        
        ctx.fillStyle = color;
        _.each(drawSpec.bars, function(d, x) {
          if (d === null) { return; }
          else if (d > zeroLine) { 
            if (pointGraph) { ctx.fillRect(x, height - d, 1, 1); }
            else { ctx.fillRect(x, height - d, 1, zeroLine > 0 ? (d - zeroLine) : d); }
          } else {
            ctx.fillStyle = altColor;
            if (pointGraph) { ctx.fillRect(x, zeroLine - d - 1, 1, 1); } 
            else { ctx.fillRect(x, height - zeroLine, 1, zeroLine - d); }
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
          if (_.isFunction(callback)) { callback(); }
        });
      },
      
      loadOpts: function($dialog) {
        var o = this.opts,
          $viewLimits = $dialog.find('.view-limits'),
          $maxHeightPixels = $dialog.find('.max-height-pixels'),
          altColorOn = this.validateColor(o.altColor);
        $dialog.find('[name=altColorOn]').attr('checked', altColorOn).change();
        $dialog.find('[name=altColor]').val(altColorOn ? o.altColor :'128,128,128').change();
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
        drawLimit: {squish: 500, pack: 100},
        maxFetchWindow: 100000,
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
        // TODO: Set maxFetchWindow using some heuristic based on how many items are in the tabix index
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
          var ref = fields.ref || '',
            alt = fields.alt || '';
          return (ref.length > alt.length ? ref : alt) || '';
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
            drawSpec = {layout: self.type('bed').stackedLayout(_.map(lines, lineToInterval), width, calcPixInterval)};
            drawSpec.width = width;
          }
          callback(drawSpec);
        }
      
        // Don't even attempt to fetch the data if we can reasonably estimate that we will fetch too much data, as this will only delay other requests.
        // TODO: cache results so we aren't refetching the same regions over and over again.
        if ((end - start) > self.opts.maxFetchWindow) {
          callback({tooMany: true});
        } else {
          $.ajax(this.ajaxDir() + 'tabix.php', {
            data: {range: range, url: this.opts.bigDataUrl},
            success: success
          });
        }
      },
    
      render: function(canvas, start, end, density, callback) {
        var ctx = canvas.getContext && canvas.getContext('2d'),
          urlTemplate = this.opts.url ? this.opts.url : 'javascript:void("'+this.opts.name+':$$")',
          lineHeight = density == 'pack' ? 27 : 6,
          colors = {a:'255,0,0', t:'255,0,255', c:'0,0,255', g:'0,255,0'},
          drawLimit = this.opts.drawLimit && this.opts.drawLimit[density],
          areas = null;
        if (!ctx) { throw "Canvas not supported"; }
        if (density == 'pack') { areas = this.areas[canvas.id] = []; }
        ctx.fillStyle = "rgb(0,0,0)";
        this.prerender(start, end, density, {width: canvas.width}, function(drawSpec) {
          if ((drawLimit && drawSpec.length > drawLimit) || drawSpec.tooMany) { 
            canvas.height = 0;
            // This applies styling that indicates there was too much data to load/draw and that the user needs to zoom to see more
            canvas.className = canvas.className + ' too-many';
          } else if (density == 'dense') {
            canvas.height = 15;
            _.each(drawSpec, function(pInt) {
              ctx.fillRect(pInt.x, 1, pInt.w, 13);
            });
          } else {
            canvas.height = drawSpec.layout.length * lineHeight;
            _.each(drawSpec.layout, function(l, i) {
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
                    data.pInt.oPrev, // continuation from previous tile?
                    altColor, // label color
                    '<span style="color: rgb(' + refColor + ')">' + data.d.ref + '</span><br/>' + data.d.alt, // label
                    data.d.info
                  ]);
                }
              });
            });
          }
          if (_.isFunction(callback)) { callback(); }
        });
      }
    },
  
    // =====================================================================
    // = bigBed format: http://genome.ucsc.edu/goldenPath/help/bigBed.html =
    // =====================================================================
  
    bigbed: {
      defaults: {
        chromosomes: '',
        itemRgb: 'off',
        colorByStrand: '',
        useScore: 0,
        group: 'user',
        priority: 'user',
        offset: 0,
        detail: false,
        url: '',
        htmlUrl: '',
        drawLimit: {squish: 500, pack: 100},
        maxFetchWindow: 0
      },
    
      init: function() {
        if (!this.opts.bigDataUrl) {
          throw new Error("Required parameter bigDataUrl not found for bigBed track at " + JSON.stringify(this.opts) + (this.opts.lineNum + 1));
        }
      },
      
      parse: function(lines) {
        var self = this,
          middleishPos = self.browserOpts.genomeSize / 2,
          cache = new IntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'}),
          ajaxUrl = self.ajaxDir() + 'bigbed.php',
          remote;
        
        remote = new RemoteTrack(cache, function(start, end, storeIntervals) {
          range = self.chrRange(start, end);
          $.ajax(ajaxUrl, {
            data: {range: range, url: self.opts.bigDataUrl, density: 'pack'},
            success: function(data) {
              var lines = _.filter(data.split('\n'), function(l) { var m = l.match(/\t/g); return m && m.length >= 2; });
              var intervals = _.map(lines, function(l) { 
                var itvl = self.type('bed').parseLine.call(self, l); 
                // Use BioPerl's Bio::DB:BigBed strategy for deduplicating re-fetched intervals:
                // "Because BED files don't actually use IDs, the ID is constructed from the feature's name (if any), chromosome coordinates, strand and block count."
                if (_.isUndefined(itvl.id)) {
                  itvl.id = [itvl.name, itvl.chrom, itvl.chromStart, itvl.chromEnd, itvl.strand, itvl.blockCount].join("\t");
                }
                return itvl;
              });
              storeIntervals(intervals);
            }
          });
        });
        
        self.data = {cache: cache, remote: remote};
        self.heights = {max: null, min: 15, start: 15};
        self.sizes = ['dense', 'squish', 'pack'];
        self.mapSizes = ['pack'];
        
        // Get general info on the bigBed and setup the binning scheme for the RemoteTrack
        $.ajax(ajaxUrl, {
          data: { url: self.opts.bigDataUrl },
          success: function(data) {
            // Set maxFetchWindow to avoid overfetching data.
            if (!self.opts.maxFetchWindow) {
              var meanItemsPerBp = data.itemCount / self.browserOpts.genomeSize,
                maxItemsToDraw = _.max(_.values(self.opts.drawLimit));
              self.opts.maxFetchWindow = maxItemsToDraw / meanItemsPerBp;
              self.opts.optimalFetchWindow = Math.floor(self.opts.maxFetchWindow / 3);
            }
            remote.setupBins(self.browserOpts.genomeSize, self.opts.optimalFetchWindow, self.opts.maxFetchWindow);
          }
        });
        
        return true;
      },
    
      prerender: function(start, end, density, precalc, callback) {
        var self = this,
          width = precalc.width,
          data = self.data,
          bppp = (end - start) / width,
          range = this.chrRange(start, end);
        
        function lineNum(d, setTo) {
          var key = bppp + '_' + density;
          if (!_.isUndefined(setTo)) { 
            if (!d.line) { d.line = {}; }
            return (d.line[key] = setTo);
          }
          return d.line && d.line[key]; 
        }
        
        function parseDenseData(data) {
          var drawSpec = [], 
            lines;
          lines = data.split(/\s+/g);
          _.each(lines, function(line, x) { 
            if (line != 'n/a' && line.length) { drawSpec.push({x: x, w: 1, v: parseFloat(line) * 1000}); } 
          });
          callback(drawSpec);
        }
        
        // Don't even attempt to fetch the data if density is not 'dense' and we can reasonably
        // estimate that we will fetch too many rows (>500 features), as this will only delay other requests.
        if (density != 'dense' && (end - start) > self.opts.maxFetchWindow) {
          callback({tooMany: true});
        } else {
          if (density == 'dense') {
            $.ajax(self.ajaxDir() + 'bigbed.php', {
              data: {range: range, url: self.opts.bigDataUrl, width: width, density: density},
              success: parseDenseData
            });
          } else {
            self.data.remote.fetchAsync(start, end, function(intervals) {
              var calcPixInterval, drawSpec = {};
              if (intervals.tooMany) { return callback(intervals); }
              calcPixInterval = new CustomTrack.pixIntervalCalculator(start, width, bppp, density == 'pack');
              drawSpec.layout = self.type('bed').stackedLayout.call(self, intervals, width, calcPixInterval, lineNum);
              drawSpec.width = width;
              callback(drawSpec);
            });
          }
        }
      },
    
      render: function(canvas, start, end, density, callback) {
        var self = this;
        self.prerender(start, end, density, {width: canvas.width}, function(drawSpec) {
          self.type('bed').drawSpec.call(self, canvas, drawSpec, density);
          if (_.isFunction(callback)) { callback(); }
        });
      },
      
      loadOpts: function() { return this.type('bed').loadOpts.apply(this, arguments); },
      
      saveOpts: function() { return this.type('bed').saveOpts.apply(this, arguments); }
    },
    
  
    // ==============================================================
    // = BAM format: https://samtools.github.io/hts-specs/SAMv1.pdf =
    // ==============================================================
  
    bam: {
      defaults: {
        chromosomes: '',
        itemRgb: 'off',
        color: '188,188,188',
        colorByStrand: '',
        useScore: 0,
        group: 'user',
        priority: 'user',
        offset: 0,
        detail: false,
        url: '',
        htmlUrl: '',
        drawLimit: {squish: 2000, pack: 2000},
        // If a nucleotide differs from the reference sequence in greater than 20% of quality weighted reads, 
        // IGV colors the bar in proportion to the read count of each base; the following changes that threshold for chromozoom
        alleleFreqThreshold: 0.2,
        optimalFetchWindow: 0,
        maxFetchWindow: 0,
        // The following can be "ensembl_ucsc" or "ucsc_ensembl" to attempt auto-crossmapping of reference contig names
        // between the two schemes, which IGV does, but is a perennial issue: https://www.biostars.org/p/10062/
        // I hope not to need all the mappings in here https://github.com/dpryan79/ChromosomeMappings but it may be necessary
        convertChrScheme: null
      },
      
      // The FLAG column for BAM/SAM is a combination of bitwise flags
      flags: {
        isReadPaired: 0x1,
        isReadProperlyAligned: 0x2,
        isReadUnmapped: 0x4,
        isMateUnmapped: 0x8,
        readStrandReverse: 0x10,
        mateStrandReverse: 0x20,
        isReadFirstOfPair: 0x40,
        isReadLastOfPair: 0x80,
        isThisAlignmentPrimary: 0x100,
        isReadFailingVendorQC: 0x200,
        isDuplicateRead: 0x400,
        isSupplementaryAlignment: 0x800
      },
    
      init: function() {
        var browserChrs = _.keys(this.browserOpts);
        if (!this.opts.bigDataUrl) {
          throw new Error("Required parameter bigDataUrl not found for BAM track at " +
              JSON.stringify(this.opts) + (this.opts.lineNum + 1));
        }
        this.browserChrScheme = this.type("bam").guessChrScheme(_.keys(this.browserOpts.chrPos));
      },
      
      guessChrScheme: function(chrs) {
        limit = Math.min(chrs.length * 0.8, 20);
        if (_.filter(chrs, function(chr) { return (/^chr/).test(chr); }).length > limit) { return 'ucsc'; }
        if (_.filter(chrs, function(chr) { return (/^\d\d?$/).test(chr); }).length > limit) { return 'ensembl'; }
        return null;
      },
      
      parse: function(lines) {
        var self = this,
          o = self.opts,
          middleishPos = self.browserOpts.genomeSize / 2,
          cache = new IntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'}),
          ajaxUrl = self.ajaxDir() + 'bam.php',
          remote;
        
        remote = new RemoteTrack(cache, function(start, end, storeIntervals) {
          range = self.chrRange(start, end);
          // Convert automatically between Ensembl style 1, 2, 3, X <--> UCSC style chr1, chr2, chr3, chrX as configured/autodetected
          // Note that chrM is NOT equivalent to MT https://www.biostars.org/p/120042/#120058
          switch (o.convertChrScheme) {
            case 'ensembl_ucsc': range = _.map(range, function(r) { return r.replace(/^chr/, ''); }); break;
            case 'ucsc_ensembl': range = _.map(range, function(r) { return r.replace(/^(\d\d?|X):/, 'chr$1:'); }); break;
          }
          $.ajax(ajaxUrl, {
            data: {range: range, url: self.opts.bigDataUrl},
            success: function(data) {
              var lines = _.filter(data.split('\n'), function(l) { var m = l.match(/\t/g); return m && m.length >= 2; });
              
              // Parse the SAM format into intervals that can be inserted into the IntervalTree cache
              var intervals = _.map(lines, function(l) { return self.type('bam').parseLine.call(self, l); });
              storeIntervals(intervals);
            }
          });
        });
        
        self.data = {cache: cache, remote: remote, pileup: {}, info: {}};
        self.heights = {max: null, min: 24, start: 24};
        self.sizes = ['dense', 'squish', 'pack'];
        self.mapSizes = ['pack'];
        self.noAreaLabels = true;
        self.expectsSequence = true;
        self.renderSequenceCallbacks = {};
        
        // Get general info on the bam (e.g. `samtools idxstats`, use mapped reads per reference sequence
        // to estimate maxFetchWindow and optimalFetchWindow, and setup binning on the RemoteTrack.
        $.ajax(ajaxUrl, {
          data: {url: o.bigDataUrl},
          success: function(data) {
            var mappedReads = 0,
              maxItemsToDraw = _.max(_.values(o.drawLimit)),
              bamChrs = [],
              chrScheme, meanItemsPerBp;
            _.each(data.split("\n"), function(line) {
              var fields = line.split("\t"),
                readsMappedToContig = parseInt(fields[2], 10);
              if (fields.length == 1 && fields[0] == '') { return; } // blank line
              bamChrs.push(fields[0]);
              if (_.isNaN(readsMappedToContig)) { throw new Error("Invalid output for samtools idxstats on this BAM track."); }
              mappedReads += readsMappedToContig;
            });
            
            self.data.info.chrScheme = chrScheme = self.type("bam").guessChrScheme(bamChrs);
            if (o.convertChrScheme !== false && chrScheme && self.browserChrScheme ) {
              o.convertChrScheme = chrScheme != self.browserChrScheme ? chrScheme + '_' + self.browserChrScheme : null;
            }
            self.data.info.meanItemsPerBp = meanItemsPerBp = mappedReads / self.browserOpts.genomeSize;
            self.data.info.meanItemLength = 100; // TODO: this is a total guess now, should grab this from some sampled reads.
            o.maxFetchWindow = maxItemsToDraw / meanItemsPerBp;
            o.optimalFetchWindow = Math.floor(o.maxFetchWindow / 2);
            remote.setupBins(self.browserOpts.genomeSize, o.optimalFetchWindow, o.maxFetchWindow);
          }
        });
        
        return true;
      },
      
      // Sets feature.flags[...] to a human interpretable version of feature.flag (expanding the bitwise flags)
      parseFlags: function(feature, lineno) {
        feature.flags = {};
        _.each(this.type('bam').flags, function(bit, flag) {
          feature.flags[flag] = !!(feature.flag & bit);
        });
      },
      
      // Sets feature.blocks and feature.end based on feature.cigar
      // See section 1.4 of https://samtools.github.io/hts-specs/SAMv1.pdf for an explanation of CIGAR 
      parseCigar: function(feature, lineno) {        
        var cigar = feature.cigar,
          refLen = 0,
          seqPos = 0,
          operations, lengths;
        
        feature.blocks = [];
        feature.insertions = [];
        
        ops = cigar.split(/\d+/).slice(1);
        lengths = cigar.split(/[A-Z=]/).slice(0, -1);
        if (ops.length != lengths.length) { this.warn("Invalid CIGAR '" + cigar + "' for " + feature.desc); return; }
        lengths = _.map(lengths, parseInt10);
        
        _.each(ops, function(op, i) {
          var len = lengths[i],
            block, insertion;
          if (/^[MX=]$/.test(op)) {
            // Alignment match, sequence match, sequence mismatch
            block = {start: feature.start + refLen};
            block.end = block.start + len;
            block.type = op;
            block.seq = feature.seq.slice(seqPos, seqPos + len);
            feature.blocks.push(block);
            refLen += len;
            seqPos += len;
          } else if (/^[ND]$/.test(op)) {
            // Skipped reference region, deletion from reference
            refLen += len;
          } else if (op == 'I') {
            // Insertion
            insertion = {start: feature.start + refLen, end: feature.start + refLen};
            insertion.seq = feature.seq.slice(seqPos, seqPos + len);
            feature.insertions.push(insertion);
            seqPos += len;
          } else if (op == 'S') {
            // Soft clipping; simply skip these bases in SEQ, position on reference is unchanged.
            seqPos += len;
          }
          // The other two CIGAR ops, H and P, are not relevant to drawing alignments.
        });
        
        feature.end = feature.start + refLen;
      },
      
      parseLine: function(line, lineno) {
        var o = this.opts,
          cols = ['qname', 'flag', 'rname', 'pos', 'mapq', 'cigar', 'rnext', 'pnext', 'tlen', 'seq', 'qual'],
          feature = {},
          fields = line.split("\t"),
          chrPos, blockSizes;
        
        _.each(_.first(fields, cols.length), function(v, i) { feature[cols[i]] = v; });
        // Convert automatically between Ensembl style 1, 2, 3, X <--> UCSC style chr1, chr2, chr3, chrX as configured/autodetected
        // Note that chrM is NOT equivalent to MT https://www.biostars.org/p/120042/#120058
        switch (o.convertChrScheme) {
          case 'ucsc_ensembl': feature.rname = feature.rname.replace(/^chr/, ''); break;
          case 'ensembl_ucsc': feature.rname = (/^(\d\d?|X)$/.test(feature.rname) ? 'chr' : '') + feature.rname; break;
        }
        feature.name = feature.qname;
        feature.flag = parseInt10(feature.flag);
        chrPos = this.browserOpts.chrPos[feature.rname];
        lineno = lineno || 0;
        
        if (_.isUndefined(chrPos)) { 
          this.warn("Invalid RNAME '"+feature.rname+"' at line " + (lineno + 1 + this.opts.lineNum));
          return null;
        } else if (feature.pos === '0' || !feature.cigar || feature.cigar == '*') {
          // Unmapped read. Since we can't draw these at all, we don't bother parsing them further.
          return null;
        } else {
          feature.score = _.isUndefined(feature.score) ? '?' : feature.score;
          feature.start = chrPos + parseInt10(feature.pos);  // POS is 1-based, hence no increment as for parsing BED
          feature.desc = feature.qname + ' at ' + feature.rname + ':' + feature.pos;
          this.type('bam').parseFlags.call(this, feature, lineno);
          feature.strand = feature.flags.readStrandReverse ? '-' : '+';
          this.type('bam').parseCigar.call(this, feature, lineno);
        }
        // We have to come up with something that is a unique label for every line to dedupe rows.
        // The following is technically not guaranteed by a valid BAM (even at GATK standards), but it's the best I got.
        feature.id = [feature.qname, feature.flag, feature.rname, feature.pos, feature.cigar].join("\t");
        
        return feature;
      },
      
      pileup: function(intervals, start, end) {
        var pileup = this.data.pileup,
          positionsToCalculate = {},
          numPositionsToCalculate = 0,
          i;
        
        for (i = start; i < end; i++) {
          // No need to pileup again on already-piled-up nucleotide positions
          if (!pileup[i]) { positionsToCalculate[i] = true; numPositionsToCalculate++; }
        }
        if (numPositionsToCalculate === 0) { return; } // All positions already piled up!
        
        _.each(intervals, function(interval) {
          _.each(interval.data.blocks, function(block) {
            var nt, i;
            for (i = Math.max(block.start, start); i < Math.min(block.end, end); i++) {
              if (!positionsToCalculate[i]) { continue; }
              nt = (block.seq[i - block.start] || '').toUpperCase();
              pileup[i] = pileup[i] || {A: 0, C: 0, G: 0, T: 0, N: 0, cov: 0};
              if (/[ACTGN]/.test(nt)) { pileup[i][nt] += 1; }
              pileup[i].cov += 1;
            }
          });
        });
      },
      
      coverage: function(start, width, bppp) {
        // Compare with binning on the fly in .type('wiggle_0').prerender(...)
        var j = start,
          vScale = this.data.info.meanItemsPerBp * this.data.info.meanItemLength * 2,
          curr = this.data.pileup[j],
          bars = [],
          next, bin, i;
        for (i = 0; i < width; i++) {
          bin = curr && (j + 1 >= i * bppp + start) ? [curr.cov] : [];
          next = this.data.pileup[j + 1];
          while (j + 1 < (i + 1) * bppp + start && j + 2 >= i * bppp + start) { 
            if (next) { bin.push(next.cov); }
            ++j;
            curr = next;
            next = this.data.pileup[j + 1];
          }
          bars.push(CustomTrack.wigBinFunctions.maximum(bin) / vScale);
        }
        return bars;
      },
      
      alleles: function(start, sequence, bppp) {
        var pileup = this.data.pileup,
          vScale = this.data.info.meanItemsPerBp * this.data.info.meanItemLength * 2,
          alleleFreqThreshold = this.opts.alleleFreqThreshold,
          alleleSplits = [],
          split, refNt, i, pileupAtPos;
          
        for (i = 0; i < sequence.length; i++) {
          refNt = sequence[i].toUpperCase();
          pileupAtPos = pileup[start + i];
          if (pileupAtPos && pileupAtPos.cov && pileupAtPos[refNt] / pileupAtPos.cov < (1 - alleleFreqThreshold)) {
            split = {
              x: i / bppp,
              splits: []
            };
            _.each(['A', 'C', 'G', 'T'], function(nt) {
              if (pileupAtPos[nt] > 0) { split.splits.push({nt: nt, h: pileupAtPos[nt] / vScale}); }
            });
            alleleSplits.push(split);
          }
        }
        
        return alleleSplits;
      },
      
      mismatches: function(start, sequence, bppp, intervals, width, lineNum) {
        var mismatches = [];
        sequence = sequence.toUpperCase();
        _.each(intervals, function(interval) {
          _.each(interval.data.blocks, function(block) {
            var line = lineNum(interval.data),
              nt, i, x;
            for (i = Math.max(block.start, start); i < Math.min(block.end, start + width * bppp); i++) {
              x = (i - start) / bppp;
              nt = (block.seq[i - block.start] || '').toUpperCase();
              if (nt && nt != sequence[i - start] && line) { mismatches.push({x: x, nt: nt, line: line}); }
            }
          });
        });
        return mismatches;
      },
    
      prerender: function(start, end, density, precalc, callback) {
        var self = this,
          width = precalc.width,
          sequence = precalc.sequence,
          data = self.data,
          bppp = (end - start) / width;
        
        function lineNum(d, setTo) {
          var key = bppp + '_' + density;
          if (!_.isUndefined(setTo)) { 
            if (!d.line) { d.line = {}; }
            return (d.line[key] = setTo);
          }
          return d.line && d.line[key]; 
        }
        
        // Don't even attempt to fetch the data if we can reasonably estimate that we will fetch an insane amount of rows 
        // (>500 alignments), as this will only hold up other requests.
        if (self.opts.maxFetchWindow && (end - start) > self.opts.maxFetchWindow) {
          callback({tooMany: true});
        } else {
          // Fetch from the RemoteTrack and call the above when the data is available.
          self.data.remote.fetchAsync(start, end, function(intervals) {
            var drawSpec = {sequence: !!sequence, width: width}, 
              calcPixInterval = new CustomTrack.pixIntervalCalculator(start, width, bppp, false);
            
            if (intervals.tooMany) { return callback(intervals); }

            if (!sequence) {
              // First drawing pass, with features that don't depend on sequence.
              self.type('bam').pileup.call(self, intervals, start, end);
              drawSpec.layout = self.type('bed').stackedLayout.call(self, intervals, width, calcPixInterval, lineNum);
              _.each(drawSpec.layout, function(lines) {
                _.each(lines, function(interval) {
                  interval.insertionPts = _.map(interval.d.insertions, calcPixInterval);
                });
              });
              drawSpec.coverage = self.type('bam').coverage.call(self, start, width, bppp);
            } else {
              // Second drawing pass, to draw things that are dependent on sequence, like mismatches (potential SNPs).
              drawSpec.bppp = bppp;  
              // Find allele splits within the coverage graph.
              drawSpec.alleles = self.type('bam').alleles.call(self, start, sequence, bppp);
              // Find mismatches within each aligned block.
              drawSpec.mismatches = self.type('bam').mismatches.call(self, start, sequence, bppp, intervals, width, lineNum);              
            }
            
            callback(drawSpec);
          });
        }
      },
      
      // special formatter for content in tooltips for features
      tipTipData: function(data) {
        var content = {
            position: data.d.rname + ':' + data.d.pos, 
            "read strand": data.d.flags.readStrand ? '(-)' : '(+)',
            "map quality": data.d.mapq
          };
        return content;
      },
      
      // See https://www.broadinstitute.org/igv/AlignmentData#coverage for an idea of what we're imitating
      drawCoverage: function(ctx, coverage, height) {
        _.each(coverage, function(d, x) {
          if (d === null) { return; }
          ctx.fillRect(x, Math.max(height - (d * height), 0), 1, Math.min(d * height, height));
        });
      },
      
      drawStrandIndicator: function(ctx, x, blockY, blockHeight, xScale, bigStyle) {
        var prevFillStyle = ctx.fillStyle;
        if (bigStyle) {
          ctx.beginPath();
          ctx.moveTo(x - (2 * xScale), blockY);
          ctx.lineTo(x + (3 * xScale), blockY + blockHeight/2);
          ctx.lineTo(x - (2 * xScale), blockY + blockHeight);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillStyle = 'rgb(140,140,140)';
          ctx.fillRect(x + (xScale > 0 ? -2 : 1), blockY, 1, blockHeight);
          ctx.fillRect(x + (xScale > 0 ? -1 : 0), blockY + 1, 1, blockHeight - 2);
          ctx.fillStyle = prevFillStyle;
        }
      },
      
      drawAlignment: function(ctx, width, data, i, lineHeight) {
        var self = this,
          color = self.opts.color,
          lineGap = lineHeight > 6 ? 2 : 0,
          deletionLineWidth = 2,
          insertionCaretLineWidth = lineHeight > 6 ? 2 : 1,
          halfHeight = Math.round(0.5 * lineHeight) - deletionLineWidth * 0.5;
        
        // Draw the line that shows the full alignment, including deletions
        ctx.fillStyle = ctx.strokeStyle = 'rgb(0,0,0)';
        // Note that the "- 1" below fixes rounding issues but gambles on there never being a deletion at the right edge
        ctx.fillRect(data.pInt.x, i * lineHeight + halfHeight, data.pInt.w - 1, deletionLineWidth);
        
        // First, determine and set the color we will be using
        // Note that the default color was already set in drawSpec
        if (self.opts.altColor && data.d.strand == '-') { color = self.opts.altColor; }
        ctx.fillStyle = ctx.strokeStyle = "rgb(" + color + ")";
        
        // Draw the [mis]match (M/X/=) blocks
        _.each(data.blockInts, function(bInt, blockNum) {
          var blockY = i * lineHeight + lineGap/2,
            blockHeight = lineHeight - lineGap;
          
          // Skip drawing blocks that aren't inside the canvas
          if (bInt.x + bInt.w < 0 || bInt.x > width) { return; }
          
          if (blockNum == 0 && data.d.strand == '-' && !bInt.oPrev) {
            ctx.fillRect(bInt.x + 2, blockY, bInt.w - 2, blockHeight);
            self.type('bam').drawStrandIndicator.call(self, ctx, bInt.x, blockY, blockHeight, -1, lineHeight > 6);
          } else if (blockNum == data.blockInts.length - 1 && data.d.strand == '+' && !bInt.oNext) {
            ctx.fillRect(bInt.x, blockY, bInt.w - 2, blockHeight);
            self.type('bam').drawStrandIndicator.call(self, ctx, bInt.x + bInt.w, blockY, blockHeight, 1, lineHeight > 6);
          } else {
            ctx.fillRect(bInt.x, blockY, bInt.w, blockHeight);
          }
        });
        
        // Draw insertions
        ctx.fillStyle = ctx.strokeStyle = "rgb(114,41,218)";
        _.each(data.insertionPts, function(insert) {
          if (insert.x + insert.w < 0 || insert.x > width) { return; }
          ctx.fillRect(insert.x - 1, i * lineHeight, 2, lineHeight);
          ctx.fillRect(insert.x - 2, i * lineHeight, 4, insertionCaretLineWidth);
          ctx.fillRect(insert.x - 2, (i + 1) * lineHeight - insertionCaretLineWidth, 4, insertionCaretLineWidth);
        });
      },
      
      drawAlleles: function(ctx, alleles, height, barWidth) {
        // Same colors as $.ui.genotrack._ntSequenceLoad(...) but could be configurable?
        var colors = {A: '255,0,0', T: '255,0,255', C: '0,0,255', G: '0,180,0'},
          yPos;
        _.each(alleles, function(allelesForPosition) {
          yPos = height;
          _.each(allelesForPosition.splits, function(split) {
            ctx.fillStyle = 'rgb('+colors[split.nt]+')';
            ctx.fillRect(allelesForPosition.x, yPos -= (split.h * height), Math.max(barWidth, 1), split.h * height);
          });
        });
      },
      
      drawMismatch: function(ctx, mismatch, lineOffset, lineHeight, ppbp) {
        // ppbp == pixels per base pair (inverse of bppp)
        // Same colors as $.ui.genotrack._ntSequenceLoad(...) but could be configurable?
        var colors = {A: '255,0,0', T: '255,0,255', C: '0,0,255', G: '0,180,0'},
          lineGap = lineHeight > 6 ? 2 : 0,
          yPos;
        ctx.fillStyle = 'rgb('+colors[mismatch.nt]+')';
        ctx.fillRect(mismatch.x, (mismatch.line + lineOffset) * lineHeight + lineGap / 2, Math.max(ppbp, 1), lineHeight - lineGap);
        // Do we have room to print a whole letter?
        if (ppbp > 7 && lineHeight > 10) {
          ctx.fillStyle = 'rgb(255,255,255)';
          ctx.fillText(mismatch.nt, mismatch.x + ppbp * 0.5, (mismatch.line + lineOffset + 1) * lineHeight - lineGap);
        }
      },
      
      drawSpec: function(canvas, drawSpec, density) {
        var self = this,
          ctx = canvas.getContext && canvas.getContext('2d'),
          urlTemplate = 'javascript:void("'+self.opts.name+':$$")',
          drawLimit = self.opts.drawLimit && self.opts.drawLimit[density],
          lineHeight = density == 'pack' ? 14 : 4,
          covHeight = density == 'dense' ? 24 : 38,
          covMargin = 7,
          lineOffset = ((covHeight + covMargin) / lineHeight), 
          color = self.opts.color,
          areas = null;
                
        if (!ctx) { throw "Canvas not supported"; }
        
        if (!drawSpec.sequence) {
          // First drawing pass, with features that don't depend on sequence.
          
          // If necessary, indicate there was too much data to load/draw and that the user needs to zoom to see more
          if (drawSpec.tooMany || (drawLimit && drawSpec.layout.length > drawLimit)) { 
            canvas.height = 0;
            canvas.className = canvas.className + ' too-many';
            return;
          }
          
          // Only store areas for the "pack" density.
          if (density == 'pack' && !self.areas[canvas.id]) { areas = self.areas[canvas.id] = []; }
          // Set the expected height for the canvas (this also erases it).
          canvas.height = covHeight + ((density == 'dense') ? 0 : covMargin + drawSpec.layout.length * lineHeight);
          
          // First draw the coverage graph
          ctx.fillStyle = "rgb(159,159,159)";
          self.type('bam').drawCoverage.call(self, ctx, drawSpec.coverage, covHeight);
                    
          // Now, draw alignments below it
          if (density != 'dense') {
            // Border between coverage
            ctx.fillStyle = "rgb(109,109,109)";
            ctx.fillRect(0, covHeight + 1, drawSpec.width, 1); 
            ctx.fillStyle = ctx.strokeStyle = "rgb("+color+")";
            
            _.each(drawSpec.layout, function(l, i) {
              i += lineOffset; // hackish method for leaving space at the top for the coverage graph
              _.each(l, function(data) {
                // TODO: implement special drawing of alignment features, for BAMs.
                self.type('bam').drawAlignment.call(self, ctx, drawSpec.width, data, i, lineHeight);              
                self.type('bed').addArea.call(self, areas, data, i, lineHeight, urlTemplate);
              });
            });
          }
        } else {
          // Second drawing pass, to draw things that are dependent on sequence:
          // (1) allele splits over coverage
          self.type('bam').drawAlleles.call(self, ctx, drawSpec.alleles, covHeight, 1 / drawSpec.bppp);
          // (2) mismatches over the alignments
          ctx.font = "12px 'Menlo','Bitstream Vera Sans Mono','Consolas','Lucida Console',monospace";
          ctx.textAlign = 'center';
          ctx.textBaseline = 'baseline';
          _.each(drawSpec.mismatches, function(mismatch) {
            self.type('bam').drawMismatch.call(self, ctx, mismatch, lineOffset, lineHeight, 1 / drawSpec.bppp);
          });
        }

      },
    
      render: function(canvas, start, end, density, callback) {
        var self = this;
        self.prerender(start, end, density, {width: canvas.width}, function(drawSpec) {
          var callbackKey = start + '-' + end + '-' + density;
          self.type('bam').drawSpec.call(self, canvas, drawSpec, density);
          
          // Have we been waiting to draw sequence data too? If so, do that now, too.
          if (_.isFunction(self.renderSequenceCallbacks[callbackKey])) {
            self.renderSequenceCallbacks[callbackKey]();
            delete self.renderSequenceCallbacks[callbackKey];
          }
          
          if (_.isFunction(callback)) { callback(); }
        });
      },
      
      renderSequence: function(canvas, start, end, density, sequence, callback) {
        var self = this;
        
        // If we weren't able to fetch sequence for some reason, there is no reason to proceed.
        if (!sequence) { return false; }

        function renderSequenceCallback() {
          self.prerender(start, end, density, {width: canvas.width, sequence: sequence}, function(drawSpec) {
            self.type('bam').drawSpec.call(self, canvas, drawSpec, density);
            if (_.isFunction(callback)) { callback(); }
          });
        }
        
        // Check if the canvas was already rendered (by lack of the class 'unrendered').
        // If yes, go ahead and execute renderSequenceCallback(); if not, save it for later.
        if ((' ' + canvas.className + ' ').indexOf(' unrendered ') > -1) {
          self.renderSequenceCallbacks[start + '-' + end + '-' + density] = renderSequenceCallback;
        } else {
          renderSequenceCallback();
        }
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
  
  // ==========================================================================
  // = bedDetail format: https://genome.ucsc.edu/FAQ/FAQformat.html#format1.7 =
  // ==========================================================================  
  
  CustomTrack.types.beddetail = _.clone(CustomTrack.types.bed);
  CustomTrack.types.beddetail.defaults = _.extend({}, CustomTrack.types.beddetail.defaults, {detail: true});

  // These functions branch to different methods depending on the .type() of the track
  _.each(['init', 'parse', 'render', 'renderSequence', 'prerender'], function(fn) {
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
